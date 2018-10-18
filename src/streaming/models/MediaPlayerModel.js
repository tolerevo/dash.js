/**
 * The copyright in this software is being made available under the BSD License,
 * included below. This software may be subject to other third party and contributor
 * rights, including patent rights, and no such rights are granted under this license.
 *
 * Copyright (c) 2013, Dash Industry Forum.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *  * Redistributions of source code must retain the above copyright notice, this
 *  list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above copyright notice,
 *  this list of conditions and the following disclaimer in the documentation and/or
 *  other materials provided with the distribution.
 *  * Neither the name of Dash Industry Forum nor the names of its
 *  contributors may be used to endorse or promote products derived from this software
 *  without specific prior written permission.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS AS IS AND ANY
 *  EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 *  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 *  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
 *  INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 *  NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 *  PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 *  WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *  POSSIBILITY OF SUCH DAMAGE.
 */
import UTCTiming from '../../dash/vo/UTCTiming';
import FactoryMaker from '../../core/FactoryMaker';
import {
    HTTPRequest
}
from '../vo/metrics/HTTPRequest';
import Constants from '../constants/Constants';
import ABRRulesCollection from '../rules/abr/ABRRulesCollection';
import Settings from '../../core/Settings';
import { checkParameterType, checkIsVideoOrAudioType } from '../utils/SupervisorTools';

const DEFAULT_LOCAL_STORAGE_BITRATE_EXPIRATION = 360000;
const DEFAULT_LOCAL_STORAGE_MEDIA_SETTINGS_EXPIRATION = 360000;

const DEFAULT_MIN_BUFFER_TIME = 12;
const DEFAULT_MIN_BUFFER_TIME_FAST_SWITCH = 20;

const CACHE_LOAD_THRESHOLD_VIDEO = 50;
const CACHE_LOAD_THRESHOLD_AUDIO = 5;

const FRAGMENT_RETRY_ATTEMPTS = 3;
const FRAGMENT_RETRY_INTERVAL = 1000;

const MANIFEST_RETRY_ATTEMPTS = 3;
const MANIFEST_RETRY_INTERVAL = 500;

const XLINK_RETRY_ATTEMPTS = 1;
const XLINK_RETRY_INTERVAL = 500;

const DEFAULT_LOW_LATENCY_LIVE_DELAY = 3.0;
const LOW_LATENCY_REDUCTION_FACTOR = 10;
const LOW_LATENCY_MULTIPLY_FACTOR = 5;
const LOW_LATENCY_CATCH_UP_MAX_DRIFT = 0;

const DEFAULT_XHR_WITH_CREDENTIALS = false;

function MediaPlayerModel() {

    let instance,
        UTCTimingSources,
        lastBitrateCachingInfo,
        lastMediaSettingsCachingInfo,
        retryAttempts,
        retryIntervals,
        xhrWithCredentials,
        customABRRule,
        cacheLoadThresholds,
        liveCatchUpMaxDrift;

    const DEFAULT_UTC_TIMING_SOURCE = {
            scheme: 'urn:mpeg:dash:utc:http-xsdate:2014',
            value: 'http://time.akamai.com/?iso&ms'
        };
    const context = this.context;
    const settings = Settings(context).getInstance();

    function setup() {
        UTCTimingSources = [];
        lastBitrateCachingInfo = {
            enabled: true,
            ttl: DEFAULT_LOCAL_STORAGE_BITRATE_EXPIRATION
        };
        lastMediaSettingsCachingInfo = {
            enabled: true,
            ttl: DEFAULT_LOCAL_STORAGE_MEDIA_SETTINGS_EXPIRATION
        };
        xhrWithCredentials = {
            default: DEFAULT_XHR_WITH_CREDENTIALS
        };
        customABRRule = [];

        liveCatchUpMaxDrift = LOW_LATENCY_CATCH_UP_MAX_DRIFT;

        retryAttempts = {
            [HTTPRequest.MPD_TYPE]:                         MANIFEST_RETRY_ATTEMPTS,
            [HTTPRequest.XLINK_EXPANSION_TYPE]:             XLINK_RETRY_ATTEMPTS,
            [HTTPRequest.MEDIA_SEGMENT_TYPE]:               FRAGMENT_RETRY_ATTEMPTS,
            [HTTPRequest.INIT_SEGMENT_TYPE]:                FRAGMENT_RETRY_ATTEMPTS,
            [HTTPRequest.BITSTREAM_SWITCHING_SEGMENT_TYPE]: FRAGMENT_RETRY_ATTEMPTS,
            [HTTPRequest.INDEX_SEGMENT_TYPE]:               FRAGMENT_RETRY_ATTEMPTS,
            [HTTPRequest.OTHER_TYPE]:                       FRAGMENT_RETRY_ATTEMPTS
        };

        retryIntervals = {
            [HTTPRequest.MPD_TYPE]:                         MANIFEST_RETRY_INTERVAL,
            [HTTPRequest.XLINK_EXPANSION_TYPE]:             XLINK_RETRY_INTERVAL,
            [HTTPRequest.MEDIA_SEGMENT_TYPE]:               FRAGMENT_RETRY_INTERVAL,
            [HTTPRequest.INIT_SEGMENT_TYPE]:                FRAGMENT_RETRY_INTERVAL,
            [HTTPRequest.BITSTREAM_SWITCHING_SEGMENT_TYPE]: FRAGMENT_RETRY_INTERVAL,
            [HTTPRequest.INDEX_SEGMENT_TYPE]:               FRAGMENT_RETRY_INTERVAL,
            [HTTPRequest.OTHER_TYPE]:                       FRAGMENT_RETRY_INTERVAL
        };

        cacheLoadThresholds = {};
        cacheLoadThresholds[Constants.VIDEO] = CACHE_LOAD_THRESHOLD_VIDEO;
        cacheLoadThresholds[Constants.AUDIO] = CACHE_LOAD_THRESHOLD_AUDIO;
    }

    //TODO Should we use Object.define to have setters/getters? makes more readable code on other side.
    function findABRCustomRuleIndex(rulename) {
        let i;
        for (i = 0; i < customABRRule.length; i++) {
            if (customABRRule[i].rulename === rulename) {
                return i;
            }
        }
        return -1;
    }

    function getABRCustomRules() {
        return customABRRule;
    }

    function addABRCustomRule(type, rulename, rule) {
        if (typeof type !== 'string' || (type !== ABRRulesCollection.ABANDON_FRAGMENT_RULES && type !== ABRRulesCollection.QUALITY_SWITCH_RULES) ||
            typeof rulename !== 'string') {
            throw Constants.BAD_ARGUMENT_ERROR;
        }
        let index = findABRCustomRuleIndex(rulename);
        if (index === -1) {
            // add rule
            customABRRule.push({
                type: type,
                rulename: rulename,
                rule: rule
            });
        } else {
            // update rule
            customABRRule[index].type = type;
            customABRRule[index].rule = rule;
        }
    }

    function removeABRCustomRule(rulename) {
        if (rulename) {
            let index = findABRCustomRuleIndex(rulename);
            //if no rulename custom rule has been found, do nothing
            if (index !== -1) {
                // remove rule
                customABRRule.splice(index, 1);
            }
        } else {
            //if no rulename is defined, remove all ABR custome rules
            customABRRule = [];
        }
    }

    function getStableBufferTime() {
        if (getLowLatencyEnabled()) {
            return getLiveDelay() * 0.6;
        }
        return !isNaN(settings.get().streaming.stableBufferTime) ? settings.get().streaming.stableBufferTime : settings.get().streaming.fastSwitchEnabled ? DEFAULT_MIN_BUFFER_TIME_FAST_SWITCH : DEFAULT_MIN_BUFFER_TIME;
    }

    function setCacheLoadThresholdForType(type, value) {
        checkParameterType(value, 'number');
        checkIsVideoOrAudioType(type);
        cacheLoadThresholds[type] = value;
    }

    function getCacheLoadThresholdForType(type) {
        return cacheLoadThresholds[type];
    }

    function setLastBitrateCachingInfo(enable, ttl) {
        if (typeof enable !== 'boolean' || (ttl !== undefined && (typeof ttl !== 'number' || isNaN(ttl)))) {
            throw Constants.BAD_ARGUMENT_ERROR;
        }
        lastBitrateCachingInfo.enabled = enable;
        if (ttl !== undefined) {
            lastBitrateCachingInfo.ttl = ttl;
        }
    }

    function getLastBitrateCachingInfo() {
        return lastBitrateCachingInfo;
    }

    function setLastMediaSettingsCachingInfo(enable, ttl) {
        if (typeof enable !== 'boolean' || (ttl !== undefined && (typeof ttl !== 'number' || isNaN(ttl)))) {
            throw Constants.BAD_ARGUMENT_ERROR;
        }
        lastMediaSettingsCachingInfo.enabled = enable;
        if (ttl !== undefined) {
            lastMediaSettingsCachingInfo.ttl = ttl;
        }
    }

    function getLastMediaSettingsCachingInfo() {
        return lastMediaSettingsCachingInfo;
    }

    function setRetryAttemptsForType(type, value) {
        if (typeof value !== 'number' || typeof type !== 'string' || (type !== HTTPRequest.MPD_TYPE && type !== HTTPRequest.MEDIA_SEGMENT_TYPE)) {
            throw Constants.BAD_ARGUMENT_ERROR;
        }
        retryAttempts[type] = value;
    }

    function getRetryAttemptsForType(type) {
        return getLowLatencyEnabled() ? retryAttempts[type] * LOW_LATENCY_MULTIPLY_FACTOR : retryAttempts[type];
    }

    function setRetryIntervalForType(type, value) {
        checkParameterType(value, 'number');
        retryIntervals[type] = value;
    }

    function getRetryIntervalForType(type) {
        return getLowLatencyEnabled() ? retryIntervals[type] / LOW_LATENCY_REDUCTION_FACTOR : retryIntervals[type];
    }

    function getLiveDelay() {
        if (getLowLatencyEnabled()) {
            return settings.get().streaming.liveDelay || DEFAULT_LOW_LATENCY_LIVE_DELAY;
        }
        return settings.get().streaming.liveDelay;
    }

    function addUTCTimingSource(schemeIdUri, value) {
        removeUTCTimingSource(schemeIdUri, value); //check if it already exists and remove if so.
        let vo = new UTCTiming();
        vo.schemeIdUri = schemeIdUri;
        vo.value = value;
        UTCTimingSources.push(vo);
    }

    function getUTCTimingSources() {
        return UTCTimingSources;
    }

    function removeUTCTimingSource(schemeIdUri, value) {
        checkParameterType(schemeIdUri, 'string');
        checkParameterType(value, 'string');
        UTCTimingSources.forEach(function (obj, idx) {
            if (obj.schemeIdUri === schemeIdUri && obj.value === value) {
                UTCTimingSources.splice(idx, 1);
            }
        });
    }

    function clearDefaultUTCTimingSources() {
        UTCTimingSources = [];
    }

    function restoreDefaultUTCTimingSources() {
        addUTCTimingSource(DEFAULT_UTC_TIMING_SOURCE.scheme, DEFAULT_UTC_TIMING_SOURCE.value);
    }

    function setXHRWithCredentialsForType(type, value) {
        if (!type) {
            Object.keys(xhrWithCredentials).forEach(key => {
                setXHRWithCredentialsForType(key, value);
            });
        } else {
            xhrWithCredentials[type] = !!value;
        }
    }

    function getXHRWithCredentialsForType(type) {
        const useCreds = xhrWithCredentials[type];

        return useCreds === undefined ? xhrWithCredentials.default : useCreds;
    }

    function getLowLatencyEnabled() {
        return settings.get().streaming.lowLatencyEnabled;
    }

    function setLowLatencyMaxDriftBeforeSeeking(value) {
        checkParameterType(value, 'number');
        liveCatchUpMaxDrift = value;
    }

    function getLowLatencyMaxDriftBeforeSeeking() {
        return liveCatchUpMaxDrift;
    }

    function getDefaultUtcTimingSource() {
        return DEFAULT_UTC_TIMING_SOURCE;
    }

    function reset() {
        //TODO need to figure out what props to persist across sessions and which to reset if any.
        //setup();
    }

    instance = {
        getABRCustomRules: getABRCustomRules,
        addABRCustomRule: addABRCustomRule,
        removeABRCustomRule: removeABRCustomRule,
        setLastBitrateCachingInfo: setLastBitrateCachingInfo,
        getLastBitrateCachingInfo: getLastBitrateCachingInfo,
        setLastMediaSettingsCachingInfo: setLastMediaSettingsCachingInfo,
        getLastMediaSettingsCachingInfo: getLastMediaSettingsCachingInfo,
        getStableBufferTime: getStableBufferTime,
        getCacheLoadThresholdForType: getCacheLoadThresholdForType,
        setCacheLoadThresholdForType: setCacheLoadThresholdForType,
        setRetryAttemptsForType: setRetryAttemptsForType,
        getRetryAttemptsForType: getRetryAttemptsForType,
        setRetryIntervalForType: setRetryIntervalForType,
        getRetryIntervalForType: getRetryIntervalForType,
        getLiveDelay: getLiveDelay,
        addUTCTimingSource: addUTCTimingSource,
        removeUTCTimingSource: removeUTCTimingSource,
        getUTCTimingSources: getUTCTimingSources,
        clearDefaultUTCTimingSources: clearDefaultUTCTimingSources,
        restoreDefaultUTCTimingSources: restoreDefaultUTCTimingSources,
        setXHRWithCredentialsForType: setXHRWithCredentialsForType,
        getXHRWithCredentialsForType: getXHRWithCredentialsForType,
        setLowLatencyMaxDriftBeforeSeeking: setLowLatencyMaxDriftBeforeSeeking,
        getLowLatencyMaxDriftBeforeSeeking: getLowLatencyMaxDriftBeforeSeeking,
        getDefaultUtcTimingSource: getDefaultUtcTimingSource,
        reset: reset
    };

    setup();

    return instance;
}

//TODO see if you can move this and not export and just getter to get default value.
MediaPlayerModel.__dashjs_factory_name = 'MediaPlayerModel';
export default FactoryMaker.getSingletonFactory(MediaPlayerModel);