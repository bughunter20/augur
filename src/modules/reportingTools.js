/**
 * Reporting time/period toolkit
 * @author Jack Peterson (jack@tinybike.net)
 */

"use strict";

var abi = require("augur-abi");
var async = require("async");
var utils = require("../utilities");

module.exports = {

    getCurrentPeriod: function (periodLength) {
        return Math.floor(new Date().getTime() / 1000 / periodLength);
    },

    getCurrentPeriodProgress: function (periodLength) {
        var t = parseInt(new Date().getTime() / 1000);
        return 100 * (t % periodLength) / periodLength;
    },

    hashSenderPlusEvent: function (sender, event) {
        return abi.wrap(
            utils.sha3(abi.hex(abi.bignum(sender).plus(abi.bignum(event, null, true)), true))
        ).abs().dividedBy(abi.bignum("115792089237316195423571")).floor();
    },

    // Increment vote period until vote period = current period - 1
    checkVotePeriod: function (branch, periodLength, callback) {
        var self = this;

        function incrementPeriod(branch, periodLength, next) {
            self.Consensus.incrementPeriodAfterReporting({
                branch: branch,
                onSent: function (r) {},
                onSuccess: function (r) {
                    console.log("Incremented period:", r.callReturn);
                    self.getVotePeriod(branch, function (votePeriod) {
                        next(null, votePeriod);
                    });
                },
                onFailed: next
            });
        }

        function checkPenalizeWrong(branch, votePeriod, next) {
            console.log("checkPenalizeWrong:");
            self.ExpiringEvents.getEvents(branch, votePeriod, function (events) {
                console.log(" - Events in vote period", votePeriod + ":", events);
                if (!events || events.constructor !== Array || !events.length) {
                    // if > first period, then call penalizeWrong(branch, 0)
                    return self.ConsensusData.getPenalizedUpTo(branch, self.from, function (lastPeriodPenalized) {
                        lastPeriodPenalized = parseInt(lastPeriodPenalized);
                        if (lastPeriodPenalized === 0 || lastPeriodPenalized === votePeriod - 1) { return next(null);
                        }
                        self.Consensus.penalizeWrong({
                            branch: branch,
                            event: 0,
                            onSent: function (r) {
                                console.log("penalizeWrong sent:", r);
                            },
                            onSuccess: function (r) {
                                console.log("penalizeWrong(branch, 0) success:", r);
                                console.log(abi.bignum(r.callReturn, "string", true));
                                next(null);
                            },
                            onFailed: function (err) {
                                console.error("penalizeWrong(branch, 0) error:", err);
                                next(null);
                            }
                        });
                    });
                }
                async.eachSeries(events, function (event, nextEvent) {
                    console.log(" - penalizeWrong:", event);
                    self.Consensus.penalizeWrong({
                        branch: branch,
                        event: event,
                        onSent: utils.noop,
                        onSuccess: function (r) {
                            console.log(" - penalizeWrong success:", abi.bignum(r.callReturn, "string", true));
                            nextEvent();
                        },
                        onFailed: function (err) {
                            console.error(" - penalizeWrong error:", err);
                            nextEvent(err);
                        }
                    });
                }, next);
            });
        }

        function checkIncrementPeriod(branch, periodLength, next, callback) {
            self.Branches.getVotePeriod(branch, function (votePeriod) {
                if (votePeriod < self.getCurrentPeriod(periodLength) - 1) {
                    incrementPeriod(branch, periodLength, function (err, votePeriod) {
                        if (err) return next(err);
                        console.log("New vote period:", votePeriod);
                        next(null, votePeriod);
                    });
                } else {
                    callback(null, votePeriod);
                }
            });
        }

        checkIncrementPeriod(branch, periodLength, function (err, votePeriod) {
            if (err) return callback(err);
            checkPenalizeWrong(branch, votePeriod - 1, function (err) {
                if (err) return callback(err);
                self.checkVotePeriod(branch, periodLength, callback);
            });
        }, callback);
    },

    // Make sure current period = expiration period + periodGap
    // If not, wait until it is:
    // expPeriod - currentPeriod periods
    // t % periodLength seconds
    checkTime: function (branch, event, periodLength, periodGap, callback) {
        var self = this;
        if (!callback && utils.is_function(periodGap)) {
            callback = periodGap;
            periodGap = null;
        }
        periodGap = periodGap || 1;
        function wait(branch, secondsToWait, next) {
            console.log("Waiting", secondsToWait / 60, "minutes...");
            setTimeout(function () {
                self.Consensus.incrementPeriodAfterReporting({
                    branch: branch,
                    onSent: function (r) {},
                    onSuccess: function (r) {
                        console.log("Incremented period:", r.callReturn);
                        self.getVotePeriod(branch, function (votePeriod) {
                            next(null, votePeriod);
                        });
                    },
                    onFailed: next
                });
            }, secondsToWait*1000);
        }
        this.getExpiration(event, function (expTime) {
            var expPeriod = Math.floor(expTime / periodLength);
            var currentPeriod = self.getCurrentPeriod(periodLength);
            console.log("\nreportingTools.checkTime:");
            console.log(" - Expiration period:", expPeriod);
            console.log(" - Current period:   ", currentPeriod);
            console.log(" - Target period:    ", expPeriod + periodGap);
            if (currentPeriod < expPeriod + periodGap) {
                var fullPeriodsToWait = expPeriod - self.getCurrentPeriod(periodLength) + periodGap - 1;
                console.log("Full periods to wait:", fullPeriodsToWait);
                var secondsToWait = periodLength;
                if (fullPeriodsToWait === 0) {
                    secondsToWait -= (parseInt(new Date().getTime() / 1000) % periodLength);
                }
                console.log("Seconds to wait:", secondsToWait);
                wait(branch, secondsToWait, function (err, votePeriod) {
                    if (err) return callback(err);
                    console.log("New vote period:", votePeriod);
                    self.checkTime(branch, event, periodLength, callback);
                });
            } else {
                callback(null);
            }
        });
    }
};
