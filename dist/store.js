/**
 * Copyright 2015 Oursky Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

var _cookieStorage = require('cookie-storage');

var _util = require('./util');

var cookieKeyWhiteList = ['skygear-deviceid', 'skygear-user', 'skygear-accesstoken'];
var store;

var Store = (function () {
  function Store(storage, keyWhiteList) {
    _classCallCheck(this, Store);

    this.storage = storage;
    this.keyWhiteList = keyWhiteList;
  }

  _createClass(Store, [{
    key: 'clear',
    value: function clear(callback) {
      return new Promise((function (resolve) {
        this.storage.clear();
        if (callback) {
          callback();
        }
        resolve();
      }).bind(this));
    }
  }, {
    key: 'getItem',
    value: function getItem(key, callback) {
      return new Promise((function (resolve) {
        var value = this.storage.getItem(key);
        if (callback) {
          callback(null, value);
        }
        resolve(value);
      }).bind(this));
    }
  }, {
    key: 'setItem',
    value: function setItem(key, value, callback) {
      return new Promise((function (resolve, reject) {
        if (this.keyWhiteList && this.keyWhiteList.indexOf(key) === -1) {
          reject('Saving key is not permitted');
          return;
        }
        this.storage.setItem(key, value);
        if (callback) {
          callback(value);
        }
        resolve(value);
      }).bind(this));
    }
  }, {
    key: 'removeItem',
    value: function removeItem(key, callback) {
      return new Promise((function (resolve) {
        this.storage.removeItem(key);
        if (callback) {
          callback();
        }
        resolve();
      }).bind(this));
    }
  }]);

  return Store;
})();

if (typeof window !== 'undefined') {
  var localforage = require('localforage');

  var rn = require('react-native');

  if (rn && rn.AsyncStorage) {
    var AsyncStorage = rn.AsyncStorage;
    var ReactNativeDriver = {
      _driver: 'ReactNativeAsyncStorage',
      _support: true,
      _initStorage: function _initStorage(options) {
        //eslint-disable-line
        console.log('Init ReactNativeAsyncStorage');
        return;
      },
      clear: function clear(callback) {
        return AsyncStorage.clear(callback);
      },
      getItem: function getItem(key, callback) {
        return AsyncStorage.getItem(key, callback);
      },
      setItem: function setItem(key, value, callback) {
        return AsyncStorage.setItem(key, value, callback);
      },
      removeItem: function removeItem(key, callback) {
        return AsyncStorage.removeItem(key, callback);
      },
      key: function key(n, callback) {
        //eslint-disable-line
        throw Error('Not support key in ReactNativeAsyncStorage');
      },
      keys: function keys(callback) {
        AsyncStorage.getAllKeys(callback);
      },
      length: function length(callback) {
        //eslint-disable-line
        throw Error('Not support length in ReactNativeAsyncStorage');
      },
      iterate: function iterate(iterator, callback) {
        //eslint-disable-line
        // localForage doc is incorrect,
        // https://mozilla.github.io/localForage/#config
        throw Error('Not support iterate in ReactNativeAsyncStorage');
      }
    };

    store = ReactNativeDriver;
  } else {
    if ((0, _util.isLocalStorageValid)()) {
      store = localforage;
    } else {
      var storage = new _cookieStorage.CookieStorage();
      store = new Store(storage, cookieKeyWhiteList);
    }
  }
} else {
  var localStorage = require('localStorage');
  store = new Store(localStorage);
}

exports['default'] = store;
module.exports = exports['default'];