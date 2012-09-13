/*
 * Copyright 2012 Rodrigo Reyes
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
 
var fullproof = fullproof || {};
fullproof.store = fullproof.store||{};

(function() {
"use strict";

	function WebSQLStoreIndex() {
		this.db = null;
		this.store = null;
		this.tableName = null;
		this.comparatorObject = null;
		this.useScore = false;
		this.opened = false;
	}

	function sql_table_exists_or_empty(tx, tablename, callback) {
		tx.executeSql("SELECT * FROM " + tablename + " LIMIT 1,0", [], function(tx,res) {
			if (res.rows.length == 1) {
				callback(true);
			} else {
				callback(false);
			}
		}, fullproof.make_callback_caller(callback, false));
	};
	
	function MetaData(store, callback, errorCallback) {
		this.tablename = "fullproofmetadata";
		var meta = this;
		
		this.createIndex = function(name, successCallback, errorCallback) {
			var error = fullproof.make_callback_caller(errorCallback);
			var tablename = meta.tablename;
			store.db.transaction(function(tx) {
				sql_table_exists_or_empty(tx, name, function(exists) {
					if (!exists) {
						tx.executeSql("CREATE TABLE IF NOT EXISTS "+ name +" (id NCHAR(48), value, score)", [], 
									function() {
										store.db.transaction(function(tx) {				
											tx.executeSql("CREATE INDEX IF NOT EXISTS "+ name +"_indx ON " + name + " (id)", [], function() {
												tx.executeSql("INSERT OR REPLACE INTO " + meta.tablename + " (id, initialized) VALUES (?,?)", [name, false], 
														fullproof.make_callback_caller(successCallback, true), 
														error);
											}, error);
										});
									}, error);
					} else {
						successCallback(true);
					}
				});
			});
		};

		this.loadMetaData = function(callback) {
			store.db.transaction(function(tx) {
				tx.executeSql("SELECT * FROM " + meta,tablename + " WHERE id=?", [tableName], function(tx,res) {
					var result = {};
					for (var i=0; i<res.rows.length; ++i) {
						var line = res.rows.item(i);
						result[line.id] = {name: line.id, initialized: line.initialized, ctime: line.ctime, version: line.version};
					}
					callback(result);
				}, fullproof.make_callback_caller(callback, {}));
			});
		};
		
		this.isInitialized = function(tableName, callback) {
			store.db.transaction(function(tx) {
				tx.executeSql("SELECT * FROM " + meta.tablename + " WHERE id=?", [tableName], function(tx,res) {
					if (res.rows.length == 1) {
						var line = res.rows.item(0);
						callback("true" == line.initialized);
					} else {
						callback(false)
					}
				}, fullproof.make_callback_caller(callback, false));
			});
		};
		
		this.setInitialized = function(tablename, value, callback) {
			store.db.transaction(function(tx) {
				tx.executeSql("INSERT OR REPLACE INTO " + meta.tablename + " (id, initialized) VALUES (?,?)", [tablename, value?"true":"false"],
						fullproof.make_callback_caller(callback, true),
						fullproof.make_callback_caller(callback, false));
			});
		};
		
		this.getIndexSize = function(name, callback) {
			store.db.transaction(function(tx) {
				tx.executeSql("SELECT count(*) AS cnt FROM " + name, [], function(tx,res) {
					if (res.rows.length == 1) {
						var line = res.rows.item(0);
						if (line.cnt !== undefined) {
							return callback(line.cnt);
						}
					}
					callback(false);
				}, function() {
					callback(false);
				});
			});
		};

		this.eraseMeta = function(callback) {
			var self = this;
			meta.loadMetaData(function(data) {
				store.db.transaction(function(tx) {
					var count = 0;
					for (var k in data) { ++count; }
					var synchro = fullproof.make_synchro_point(function() {
						tx.executeSql("DROP TABLE IF EXISTS "+ meta.tablename, [], fullproof.make_callback_caller(errorCallback,true), fullproof.make_callback_caller(errorCallback,false));
					}, count);
					for (var k in data) {
						tx.executeSql("DROP TABLE IF EXISTS " + k);
					}
				});
			});
		};
		
		store.db.transaction(function(tx) {
			tx.executeSql("CREATE TABLE IF NOT EXISTS "+ meta.tablename +" (id VARCHAR(52) NOT NULL PRIMARY KEY, initialized, version, ctime)", [], 
				function() {
					callback(store);
				}, fullproof.make_callback_caller(errorCallback,false))});
	}

	/**
	 * @constructor
	 */
	fullproof.store.WebSQLStore = function(){
		if (!(this instanceof fullproof.store.WebSQLStore)) {
			return new fullproof.store.WebSQLStore();
		}
				
		this.internal_init = function() {
			this.db = null;
			this.meta = null;
			this.tables = {};
			this.indexes = {};
			this.opened= false;
			this.dbName = "fullproof";
			this.dbSize = 1024*1024*5;
		}
		this.internal_init();
	};
	
	fullproof.store.WebSQLStore.getCapabilities = function() { 
		return new fullproof.Capabilities().setStoreObjects(false).setVolatile(false).setAvailable(window.openDatabase).setUseScores([true,false]);
	}
	fullproof.store.WebSQLStore.storeName = "WebsqlStore";

	
	fullproof.store.WebSQLStore.prototype.setOptions = function(params) {
		this.dbSize = params.dbSize||this.dbSize;
		this.dbName = params.dbName||this.dbName;
		return this;
	};

	function openIndex(store, name, parameters, initializer, callback, errorCallback) {
		if (store.opened == false || !store.meta) {
			return callback(false);
		}
		
		parameters = parameters||{};
		var index = new WebSQLStoreIndex();
		index.store = store;
		var useScore = parameters.getUseScores()!==undefined?(parameters.getUseScores()):false;
		
		index.db = store.db;
		index.tableName = index.name = name;
		index.comparatorObject = parameters.getComparatorObject()?parameters.getComparatorObject():(useScore?fullproof.ScoredElement.comparatorObject:undefined);
		index.useScore = useScore;
		
		var self = store;
		store.meta.isInitialized(name, function(isInit) {
			if (isInit) {
				return callback(index);
			} else {
				self.meta.createIndex(name, function() {
					self.indexes[name] = index;
					if (initializer) {
						initializer(index, function() {
							index.opened = true;
							self.meta.setInitialized(name, true, fullproof.make_callback_caller(callback, index));
						});
					} else {
						callback(index);
					}
				}, errorCallback);
			}
		});				
	}; 

	function openStore(store, parameters, callback) {
		store.opened = false;
		if (parameters.getDbName() !== undefined) {
			store.dbName = parameters.getDbName();
		}
		if (parameters.getDbSize() !== undefined) {
			store.dbSize = parameters.getDbSize();
		}
		store.db = openDatabase(store.dbName, '1.0', 'javascript search engine', store.dbSize*10);
		store.opened = true;
		store.meta = new MetaData(store, function(store) {
				callback(store);
			}, fullproof.make_callback_caller(callback,false));
	};

	
	fullproof.store.WebSQLStore.prototype.open = function(caps, reqIndexArray, callback, errorCallback) {
		var self = this;
		openStore(this, caps, function(store) {
			var synchro = fullproof.make_synchro_point(callback, reqIndexArray.length);
			for (var i=0, max=reqIndexArray.length; i<max; ++i) {
				var requestIndex = reqIndexArray[i];
				openIndex(self, requestIndex.name, requestIndex.capabilities, requestIndex.initializer, synchro);
			}
		});
	};
	
	fullproof.store.WebSQLStore.prototype.close = function(callback) {
		this.internal_init();
		callback();
	};

	fullproof.store.WebSQLStore.prototype.getIndex = function(name) {
		return this.indexes[name];
	};

	WebSQLStoreIndex.prototype.clear = function(callback) {
		var self = this;
		this.db.transaction(function(tx) {
			tx.executeSql("DELETE FROM "+ self.tableName, [], fullproof.make_callback_caller(callback, true), fullproof.make_callback_caller(callback, false));
		});
	};

	WebSQLStoreIndex.prototype.inject = function(word, value, callback) {
		var self = this;
		this.db.transaction(function(tx) {
			if (value instanceof fullproof.ScoredElement) {
				tx.executeSql("INSERT OR REPLACE INTO " + self.tableName + " (id,value, score) VALUES (?,?,?)", [word, value.value, value.score], fullproof.make_callback_caller(callback, true), fullproof.make_callback_caller(callback, false));
			} else {
				tx.executeSql("INSERT OR REPLACE INTO " + self.tableName + " (id,value) VALUES (?,?)", [word, value], fullproof.make_callback_caller(callback, true), fullproof.make_callback_caller(callback, false));
			}
		});
	};

	WebSQLStoreIndex.prototype.injectBulk = function(wordArray, valuesArray, callback, progress) {
		var self = this;
		if (wordArray.length != valuesArray.length) {
			throw "Can't injectBulk, arrays length mismatch";
		}
		var batchSize = 100;
		var transactionsExpected = wordArray.length / batchSize + (wordArray%batchSize>0?1:0);
		var bulk_synchro = fullproof.make_synchro_point(callback, undefined, true);
		var totalSize = wordArray.length;
		var processBulk = function(wArray, vArray) {
			var curWords = wArray.splice(0, batchSize<wArray.length?batchSize:wArray.length);
			var curValues = vArray.splice(0, batchSize<vArray.length?batchSize:vArray.length);
			if (curWords.length == 0) {
				bulk_synchro(false);
			}
			if (progress) {
				progress((totalSize - wArray.length)/totalSize);
			}
			
			var synchronizer = fullproof.make_synchro_point(function() {
				fullproof.call_new_thread(processBulk, wArray, vArray);
			}, curWords.length);
			
			self.db.transaction(function(tx) {
				for (var i=0; i<curWords.length; ++i) {
					var value = curValues[i];
					if (value instanceof fullproof.ScoredEntry) {
						if (self.useScore) {
							tx.executeSql("INSERT INTO " + self.tableName + " (id,value, score) VALUES (?,?,?)", [curWords[i], value.value, value.score], synchronizer, synchronizer);
						} else {
							tx.executeSql("INSERT INTO " + self.tableName + " (id,value) VALUES (?,?)", [curWords[i], value.value], synchronizer, synchronizer);
						}
					} else {
						if (self.useScore) {
							tx.executeSql("INSERT INTO " + self.tableName + " (id,value, score) VALUES (?,?,?)", [curWords[i], value, 1.0], synchronizer, synchronizer);
						}
						else {
							tx.executeSql("INSERT INTO " + self.tableName + " (id,value) VALUES (?,?)", [curWords[i], value], 
									function() {
								synchronizer();
							}, function() {
								synchronizer(true);
							});
						}
					}
				}
			});
		};
		
		processBulk(wordArray, valuesArray);
		
	};
	
	/**
	 * WebSQLStore does not support object storage, only primary values, so we rely
	 * on the sql engine sorting functions. ORDER BY should provide fine results as long as
	 * the datatype of values is consistant.
	 */
	WebSQLStoreIndex.prototype.lookup = function(word, callback) {
		var self = this;
		this.db.transaction(function(tx) {
			tx.executeSql("SELECT * FROM " + self.tableName + " WHERE id=? ORDER BY value ASC", [word],
					function(tx,res) {
						var result = [];
						for (var i=0; i<res.rows.length; ++i) {
							var item = res.rows.item(i);
							if (item) {
								if (item.score === null || item.score === undefined || item.score === false) {
									result.push(item.value);
								} else {
									result.push(new fullproof.ScoredEntry(item.id, item.value, item.score));
								}
							}
						}
						callback(new fullproof.ResultSet(self.comparatorObject).setDataUnsafe(result));
					}, 
					function() {
						callback(false);
					});
		});
	};
	
})();
