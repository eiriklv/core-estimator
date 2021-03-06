/*
 * Core Estimator
 * CPU core estimation timing attack using web workers
 * 2013-06-01
 * 
 * Copyright ΩF:∅ Working Group contributors
 * License: X11/MIT
 *   See LICENSE.md
 */

/*! @source https://github.com/oftn/core-estimator/blob/master/core-estimator.js */

(function() {
	"use strict";

	// Set up performance testing function
	var performance = self.performance || Date;
	if (!performance.now) {
		if (performance.webkitNow) {
			performance.now = performance.webkitNow;
		} else {
			performance = Date;
		}
	}

	// Get the location of the currently running script
	var path = (function () {
		var
		  filename = "fileName"
		, stack = "stack"
		, stacktrace = stack + "trace"
		, loc
		, matcher = function (stack, matchedLoc) {
			loc = matchedLoc;
		}
		;

		try { 0(); } catch (ex) {
			if (filename in ex) { // Firefox
				loc = ex[filename];
			} else if (stacktrace in ex) { // Opera
				ex[stacktrace].replace(/called from line \d+, column \d+ in (.*):/gm, matcher);
			} else if (stack in ex) { // WebKit, Blink, and IE10
				ex[stack].replace(/at.*?\(?(\S+):\d+:\d+\)?$/g, matcher);
			}
			if (!loc) {
				throw new Error("Your browser does not currently support Core Estimator.");
			}
			return loc;
		}
	}());

	// Path to workload.js is derived from the path of the running script.
	var workload = path.replace(/\/[^\/]+$/, "/workload.js");

	var dom_implemented = !!navigator.cores;
	var previously_run = false;

	// Set navigator.cores to a sane value before getCores is ever run
	if (!dom_implemented) {
		/** @expose */ navigator.cores = 1;
	}

	/**
	 * navigator.getCores(callback)
	 *
	 * Performs the statistical test to determine the correct number of cores
	 * and calls its callback with the core number as its argument.
	 *
	 * @expose
	 **/
	navigator.getCores = function(_continue, options) {
		options = options || {};
		if (!('use_cache' in options)) {
			options['use_cache'] = true;
		}

		// If we already have an answer, return early.
		if (dom_implemented || (options['use_cache'] && previously_run)) {
			_continue(navigator.cores);
			return;
		}

		var workers = []; // An array of workers ready to run the payload

		var worker_size = 1;
		var control;
		var controldata = [];

		iterate(function(worker_size, report) {

			measure(workers, worker_size, 5, function(data) {

				if (worker_size === 1) {
					Array.prototype.push.apply(controldata, data);
					control = analyse(controldata);

					report(true);
				} else {
					var group = analyse(data);

					var gv_gs = group.uvariance / group.size;
					var cv_cs = control.uvariance / control.size;
					var tscore = (group.mean - control.mean) / Math.sqrt(gv_gs + cv_cs);
					var freedom = Math.pow(gv_gs + cv_cs, 2) /
						(Math.pow(group.uvariance, 2) / (Math.pow(group.size, 2) * (group.size - 1) ) +
						Math.pow(control.uvariance, 2) / (Math.pow(control.size, 2) * (control.size - 1))); // don't ask

					report(accept(tscore, freedom));
				}
			});

		}, function(cores) {

			// Terminate our workers, we don't need them anymore.
			for (var i = 0, len = workers.length; i < len; i++) {
				workers[i].terminate();
			}

			// We found an estimate
			navigator.cores = cores;
			previously_run = true;
			_continue(cores);

		}, options['progress']);
	}

	/**
	 * measure()
	 *
	 * Given a set of workers and a sample size,
	 * it calls back with an array of times it took
	 * to run all the workers simultaneously.
	 *
	 **/
	function measure(workers, worker_size, sample_size, _continue) {
		var samples = [];

		// Guarantee that we have enough workers
		for (var i = workers.length; i < worker_size; i++) {
			workers.push(new Worker(workload));
		}

		loop(function(_repeat) {
			var begin, left = worker_size; // Number of workers we are waiting to finish

			// When a worker completes
			for (var i = 0; i < worker_size; i++) {
				workers[i].onmessage = function() {
					left--;
					if (!left) {
						sample_size--;
						samples.push(performance.now() - begin);
						if (sample_size) {
							_repeat();
						} else {
							_continue(samples);
						}
					}
				}
			}

			// Kick-off our workers and start the clock
			for (var i = 0; i < worker_size; i++) {
				workers[i].postMessage(null);
			}
			begin = performance.now();
		});
	}

	function loop(body) {
		(function next() {
			body(next);
		}());
	}


	/**
	 * iterate(test, answer, progress)
	 *
	 * Given a test function and a callback,
	 * it will conduct a binary search to find the highest value
	 * which the test function returns as passing.
	 *
	 * Optionally takes a callback to report the state of the iterator.
	 *
	 **/
	function iterate(test, answer, progress) {
		// Let S be the set of possible core numbers on this machine.
		// S = {x \in N | x != 0 }.

		var min = 1, max = 1/0;

		// Find an upper bound (max - 1) on S by testing powers of two.
		// During these tests, we also come across a lower bound (min).
		(function repeat(cores) {

			if (progress) {
				progress(min, max, cores);
			}
			test(1, function() {
				test(cores, function(pass) {
					if (pass) {
						min = cores;

						// Repeat the test with double the cores.
						repeat(2 * cores);
					} else {
						max = cores;

						// * If S has one element, we found the number
						// * S has one element iff max - min = 1.
						// * Given max = min * 2 in invariant of this test,
						//       S has one element iff min = 1.
						if (min === 1) {
							return answer(min);
						}

						// We have finally found our upper bound; search space.
						search(min * 3 / 2, min / 4);
					}
				});
			});
		}(2));

		function search(center, pivot) {

			if (progress) {
				progress(min, max, center);
			}

			test(1, function() {
				test(center, function(pass) {
					if (pass) {
						min = center;
						center += pivot;
					} else {
						max = center;
						center -= pivot;
					}
					if (max - min === 1) {
						return answer(min);
					}
					if (!pivot) {
						// This means we haven't found an answer.
						// Oh well. Answer with the upper bound.
						return answer(max - 1);
					}
					search(center, pivot >> 1);
				});
			});
		}
	}

	/**
	 * analyse(array)
	 *
	 * Given an array of values, it returns a set of statistics.
	 *
	 **/
	function analyse(data) {
		// If we have no values, return null.
		var len = data.length;
		if (!len) {
			return null;
		}

		// Iterate through data, gathering information.
		var min = 1/0, max = -1/0;
		var sum = 0;
		var sum_squared_datum = 0;
		for (var i = 0; i < len; i++) {
			var datum = data[i];
			if (datum < min) min = datum;
			if (datum > max) max = datum;
			sum += datum;
			sum_squared_datum += Math.pow(datum, 2);
		}

		// Calculate statistics from information.
		var mean = sum / len;
		var mean_squared = Math.pow(mean, 2);
		var variance = 0;
		var unbiased_variance = 0;

		if (len > 1) {
			variance = sum_squared_datum / len - mean_squared;
			unbiased_variance = (sum_squared_datum - len * mean_squared) / (len - 1);
		}

		// Store statistics into object
		var stats = {
			size: len,
			//min: min,
			//max: max,
			mean: mean,
			//variance: variance,
			uvariance: unbiased_variance
		};

		return stats;
	};

	/**
	 * accept(tscore, freedom)
	 *
	 * Given a t-score and the number of degrees of freedom,
	 * return a boolean indicating whether the tscore is less than the
	 * critical value found in the t-table.
	 *
	 **/
	
	// This object is created from a t-table given a one-sided test and a 99.5% confidence.
	/** @const */ var table = {1: 63.66, 2: 9.925, 3: 5.841, 4: 4.604, 5: 4.032, 6: 3.707, 7: 3.499, 8: 3.355, 9: 3.25, 10: 3.169, 11: 3.106, 12: 3.055, 13: 3.012, 14: 2.977, 15: 2.947, 16: 2.921, 17: 2.898, 18: 2.878, 19: 2.861, 20: 2.845, 21: 2.831, 22: 2.819, 23: 2.807, 24: 2.797, 25: 2.787, 26: 2.779, 27: 2.771, 28: 2.763, 29: 2.756, 30: 2.75, 32: 2.738, 34: 2.728, 36: 2.719, 38: 2.712, 40: 2.704, 42: 2.698, 44: 2.692, 46: 2.687, 48: 2.682, 50: 2.678, 55: 2.668, 60: 2.66, 65: 2.654, 70: 2.648, 80: 2.639, 100: 2.626, 150: 2.609, 200: 2.601};

	function accept(tscore, freedom) {
		var keys = Object.keys(table);

		var key_low = keys.reduce(function(p, c) { if(freedom < c) return p; return c; });
		var key_high = keys.reduce(function(p, c) { if(freedom > c) return p; return c; });

		var span = key_high - key_low;
		var critical = linear(table[key_low], table[key_high], (freedom - key_low) / span);

		return tscore < critical;
	}

	function linear(a, b, t) { return a + (b - a) * t; }
}());
