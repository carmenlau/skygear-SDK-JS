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

var _slicedToArray = (function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i['return']) _i['return'](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError('Invalid attempt to destructure non-iterable instance'); } }; })();

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

var _cache = require('./cache');

var _cache2 = _interopRequireDefault(_cache);

var _asset = require('./asset');

var _asset2 = _interopRequireDefault(_asset);

var _query_result = require('./query_result');

var _query_result2 = _interopRequireDefault(_query_result);

var _ = require('lodash');

var Database = (function () {
  function Database(dbID, container) {
    _classCallCheck(this, Database);

    if (dbID !== '_public' && dbID !== '_private') {
      throw new Error('Invalid database_id');
    }
    this.dbID = dbID;
    this.container = container;
    this._cacheStore = new _cache2['default'](this.dbID);
  }

  _createClass(Database, [{
    key: 'query',
    value: function query(_query) {
      var cacheCallback = arguments.length <= 1 || arguments[1] === undefined ? false : arguments[1];

      var remoteReturned = false;
      var cacheStore = this.cacheStore;
      var Cls = _query.recordCls;
      var payload = _.assign({
        database_id: this.dbID //eslint-disable-line
      }, _query.toJSON());
      if (cacheCallback) {
        cacheStore.get(_query.hash).then(function (body) {
          if (remoteReturned) {
            return;
          }
          var records = _.map(body.result, function (attrs) {
            return new Cls(attrs);
          });
          var result = _query_result2['default'].createFromResult(records, body.info);
          cacheCallback(result, true);
        }, function (err) {
          console.log('No cache found', err);
        });
      }
      return new Promise((function (resolve, reject) {
        this.container.makeRequest('record:query', payload).then(function (body) {
          var records = _.map(body.result, function (attrs) {
            return new Cls(attrs);
          });
          var result = _query_result2['default'].createFromResult(records, body.info);
          remoteReturned = true;
          cacheStore.set(_query.hash, body);
          resolve(result);
        }, function (err) {
          reject(err);
        });
      }).bind(this));
    }
  }, {
    key: '_presaveAssetTask',
    value: function _presaveAssetTask(key, asset) {
      if (asset.file) {
        return new Promise((function (resolve, reject) {
          this.container.makeUploadAssetRequest(asset).then(function (a) {
            resolve([key, a]);
          }, function (err) {
            reject(err);
          });
        }).bind(this));
      } else {
        return Promise.resolve([key, asset]);
      }
    }
  }, {
    key: '_presave',
    value: function _presave(record) {
      var self = this;

      return new Promise(function (resolve, reject) {
        // for every (key, value) pair, process the pair in a Promise
        // the Promise should be resolved by the transformed [key, value] pair
        var tasks = _.map(record, function (value, key) {
          if (value instanceof _asset2['default']) {
            return self._presaveAssetTask(key, value);
          } else {
            return Promise.resolve([key, value]);
          }
        });

        Promise.all(tasks).then(function (keyvalues) {
          _.each(keyvalues, function (_ref) {
            var _ref2 = _slicedToArray(_ref, 2);

            var key = _ref2[0];
            var value = _ref2[1];

            record[key] = value;
          });
          resolve(record);
        }, function (err) {
          reject(err);
        });
      });
    }
  }, {
    key: 'save',
    value: function save(record) {
      var self = this;
      return new Promise(function (resolve, reject) {
        self._presave(record).then(function (r) {
          var payload = {
            database_id: self.dbID, //eslint-disable-line
            records: [r.toJSON()]
          };
          return self.container.makeRequest('record:save', payload);
        }).then(function (body) {
          var result = body.result[0];
          if (result._type === 'error') {
            reject(result);
          } else {
            record.update(result);
            record.updateTransient(body.result[0]._transient, true);
            resolve(record);
          }
        }, function (err) {
          reject(err);
        })['catch'](function (e) {
          reject(e);
        });
      });
    }
  }, {
    key: 'del',
    value: function del(record) {
      var ids = [record.id];
      var payload = _.assign({
        database_id: this.dbID, //eslint-disable-line
        ids: ids
      });
      return new Promise((function (resolve, reject) {
        this.container.makeRequest('record:delete', payload).then(function (body) {
          var result = body.result[0];
          if (result._type === 'error') {
            reject(result);
          } else {
            resolve();
          }
        }, function (err) {
          reject(err);
        });
      }).bind(this));
    }
  }, {
    key: 'clearCache',
    value: function clearCache() {
      return this._cacheStore.reset();
    }
  }, {
    key: 'cacheStore',
    get: function get() {
      return this._cacheStore;
    }
  }]);

  return Database;
})();

exports['default'] = Database;
module.exports = exports['default'];