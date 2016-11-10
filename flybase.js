var Flybase = function(apiKey, database, collection){
	this.database = database;
	this.apiKey = apiKey;
	this.collection = collection;
	this.socket = null;
	this.query = {};
	this.joins = {};
	this.room = md5( database + '/' + collection ); 		//	this will be a hash of the room..
	this.currentItem;
	this.debug = false;
	this.mockconsole = mockconsole();
	this.sessionId;

	this.apiUrl = 'https://api.flybase.io';
	this.pushUrl = 'https://push.flybase.io';

	return this.start();
};

Flybase.prototype.setDebug = function( bool ){
	this.debug = bool;
}

Flybase.prototype.toString = function(){
	return this.database + '/' + this.collection;
};

Flybase.prototype.isEmpty = function(object) {
	for(var key in object) {
		if(object.hasOwnProperty(key)){
			return false;
		}
	}
	return true;
};
Flybase.prototype.extend = function(base) {
	var parts = Array.prototype.slice.call(arguments, 1);
	parts.forEach(function (p) {
		if (p && typeof (p) === 'object') {
			for (var k in p) {
				if (p.hasOwnProperty(k)) {
					base[k] = p[k];
				}
			}
		}
	});
	return base;
};

// We also allow a 'logger' option. It can be any object that implements
// log, warn, and error methods.
// We log nothing by default, following "the rule of silence":
// http://www.linfo.org/rule_of_silence.html
Flybase.prototype.logger = function( callback ){
	// we assume that if you're in debug mode and you didn't
	// pass in a logger, you actually want to log as much as
	// possible.
	if (this.debug) {
		return callback || console;
	} else {
		return callback || this.mockconsole;
	}
};

Flybase.prototype.start = function(){
	this.logger().log( "Starting connection" );
	this.startWebSocket( this.room );
	this.validate_key();
	return this;
};

/*
	isReady is a function that makes sure the connection is done, this is recommended by anything related to the connection to the \
	real-time server.
*/
Flybase.prototype.isReady = function( callback ){
	var _this = this;
	if( callback ){
		function ReadyOrNot(){
			if( typeof _this.sessionId !== "undefined" ){
				return callback();
			}else{
				setTimeout(function(){
					ReadyOrNot()
				}, 500);
			}
		}
		ReadyOrNot();
	}else{
		return new Promise(function(resolve, reject) {
			function ReadyOrNot(resolve, reject){
				if( typeof _this.sessionId !== "undefined" ){
					resolve( true );
				}else{
					setTimeout(function(){
						ReadyOrNot(resolve, reject );
					}, 500);
				}
			}
			ReadyOrNot(resolve, reject);
		});
	}
};

Flybase.prototype.validate_key = function(){
	var url = this.pushUrl+'/validate_key/' + this.apiKey;
	fetch(url, {
		method: 'GET'
	}).then(function(response) {
		if (response.status >= 200 && response.status < 400){
			return response.text();
		}
	}, function(error) {
		this.logger().log(error.message);
	});
};


Flybase.prototype.startWebSocket = function ( channel ){
	var _this = this;
	this.socket = io(
		this.pushUrl,{
		'reconnection': true,
		'reconnectionDelay': 2000,
		'reconnectionAttempts': 10000,
		forceNew: true
	});

	var data = {};
	data.room = this.room;
	data.apiKey = this.apiKey;
	data.db = this.database;
	data.collection = this.collection;

	this.logger().log( "subscribing to channel " + channel );
	this.socket.emit('subscribe', data );

	this.socket.on("connect", function() {
		_this.sessionId = _this.socket.io.engine.id;
//		_this.logger().log( _this.sessionId );
		_this.logger().log( "Connected" );
	}).on("disconnect", function() {
		_this.logger().log( "Disconnected" );
	}).on("connecting",function(){
		_this.logger().log( "Connecting" );
	});

	this.socket.on('connected', function (data) {
		_this.logger().log( data );
	});
	this.socket.on('status', function (data) {
		_this.logger().log( data );
	});
	this.socket.on('whoami', function (data) {
//		_this.sessionId = _this.socket.io.engine.id;
		_this.sessionId = data;
//		console.log( data );
	});

//	this.socket.emit('status', "Hello Status");
	this.socket.emit('whoami', '');
	return true;
};

/*
	optionalParams (optional) - [q=<query>][&c=true][&f=<fields>][&fo=true][&s=<order>][&sk=<skip>][&l=<limit>]
	example - {c : true, fo : true, l : 500}
	q=<query> - restrict results by the specified JSON query
	c=true - return the result count for this query
	f=<set of fields> - specify the set of fields to include or exclude in each document (1 - include; 0 - exclude)
	fo=true - return a single document from the result set (same as findOne() using the mongo shell
	s=<sort order> - specify the order in which to sort each specified field (1- ascending; -1 - descending)
	sk=<num results to skip> - specify the number of results to skip in the result set; useful for paging
	l=<limit> - specify the limit for the number of results
*/
Flybase.prototype.where = function( where ){
	this.query.q = where;
	return this;
}

Flybase.prototype.lookup = function( value, collections, callback ){
	var self = this;
	self.joins.value = value;
	self.joins.collections = collections;

	var returnCount = 0;
	var expectedCount = self.joins.collections.length;
	var mergedObject = {};
	if( callback ){
		self.joins.collections.forEach(function (p) {
			var p2 = p.split(".");
			var coll = p2[0];
			var field = p2[1];
			var query = {
				q: "{"+field+":"+self.joins.value+"}",
				l: 1
			};
			self.listDocuments2(query, coll, function(data){
				if( data.count() ){
					var rec = data.first().value();
					if( rec[field] === self.joins.value ){
						delete rec._id;
						self.extend( mergedObject, rec );
					}
				}
				if (++returnCount === expectedCount) {
					callback( mergedObject );
				}
			});
		});
	}else{
		return new Promise(function(resolve, reject) {
			self.joins.collections.forEach(function (p) {
				var p2 = p.split(".");
				var coll = p2[0];
				var field = p2[1];
				var query = {
					q: "{"+field+":"+self.joins.value+"}",
					l: 1
				};
				self.listDocuments2(query, coll, function(data){
					if( data.count() ){
							var rec = data.first().value();
							if( rec[field] === self.joins.value ){
								delete rec._id;
								self.extend( mergedObject, rec );
							}
						}
					if (++returnCount === expectedCount) {
						if( mergedObject ){
							resolve( mergedObject );
						}else{
							reject( mergedObject );
						}
					}
				});
			});
		});
	}
}


Flybase.prototype.fields = function( field ){
	this.query.f = field;
	return this;
}

Flybase.prototype.skip = function( n ){
	this.query.sk = n;
	return this;
}

Flybase.prototype.orderBy = function( o ){
	this.query.s = o;
	return this;
}

Flybase.prototype.limit = function( n ){
	this.query.l = n;
	return this
}
Flybase.prototype.limitToFirst = function( n ){
	this.query.l = n;
//	this.query.s = {"_id": 1};
	return this;
}
Flybase.prototype.limitToLast = function( n ){
	this.query.l = n;
	this.query.s = {"_id": -1};
	return this;
}

Flybase.prototype.Connected = function( callback ){
	this.onOnline( callback );
	this.onOffline( callback );
};

Flybase.prototype.onOnline = function( callback ){
	var myEvent = window.attachEvent || window.addEventListener;
	myEvent("online", function(e) {
		callback( true );
	}, false);
}

Flybase.prototype.onOffline = function( callback ){
	var myEvent = window.attachEvent || window.addEventListener;
	myEvent("offline", function(e) {
		callback( false );
	}, false);
}

Flybase.prototype.onDisconnect = function( callback ){
//	window.onbeforeunload = callback;
/*
	window.addEventListener("beforeunload", function (e) {
		callback();
	});
*/

	var myEvent = window.attachEvent || window.addEventListener;
	var chkevent = window.attachEvent ? 'onbeforeunload' : 'beforeunload'; /// make IE7, IE8 compitable
	myEvent(chkevent, function(e) { // For >=IE7, Chrome, Firefox
		callback();
	});

/*
	var endpoint = 'disconnect/'+database+'/'+collection;
	this.rpostp(endpoint, callback);
*/
};
Flybase.prototype.Disconnected = function( data ) {
//	this.logger().log('A> ' + this.sessionId );
	var endpoint = 'disconnect/' + this.sessionId + '/' + this.database + '/' + this.collection;
	this.rpostp(endpoint, data );
};

Flybase.prototype.promised = function( data ){
	return new Promise(function(resolve, reject) {
		if( data.count() ){
			resolve( data );
		}else{
			if( data ){
				resolve( data );
			}else{
				reject( false );
			}
		}
	});
};

//	Set notifications when event is returned...
Flybase.prototype.on = function( key, callback ){
	var self = this;
	if( key == 'value' ){
		if( callback ){
			self.listDocuments(callback,self.query);
		}else{
			return new Promise(function(resolve, reject) {
				self.listDocuments(function(data){
					if( data.count() ){
						resolve( data );
					}else{
						reject( false );
					}
				},self.query);
			});
		}
//		self.on('added', callback);
	}else{
		self.socket.on( key, function(res){
			if( key == 'added' || key == 'changed' || key == 'removed' || key == 'online' ){
				var data = self.processData( res );
				self.currentItem = data;
			}else{
				var IS_JSON = true;
				try{
					var json = JSON.parse( res );
				}catch(err){
					IS_JSON = false;
				}
				if( IS_JSON ){
					var data = json;
				}else{
					var data = res;
				}
			}
			callback( data );
		});
	}
};

Flybase.prototype.once = function( key, callback ){
	var self = this;
	if( key == 'value' ){
		//	check query based on other functions..
		if( callback ){
			self.listDocuments(callback,self.query);
			return true;
		}else{
			//	check query based on other functions..
			return new Promise(function(resolve, reject) {
				self.listDocuments(function(data){
					if( data.count() ){
						resolve( data );
					}else{
						reject( false );
					}
				},self.query);
			});
		}
	}else{
		if( callback ){
			self.socket.on( key, function(res){
				if( key == 'added' || key == 'changed' || key == 'removed' || key == 'online' ){
					var data = self.processData( res );
					self.currentItem = data;
				}else{
					var IS_JSON = true;
					try{
						var json = JSON.parse( res );
					}catch(err){
						IS_JSON = false;
					}
					if( IS_JSON ){
						var data = json;
					}else{
						var data = res;
					}
				}
				callback( data );
				return true;
			});
		}else{
			return new Promise(function(resolve, reject) {
				self.socket.on( key, function(res){
					if( key == 'added' || key == 'changed' || key == 'removed' || key == 'online' ){
						var data = self.processData( res );
						self.currentItem = data;
					}else{
						var IS_JSON = true;
						try{
							var json = JSON.parse( res );
						}catch(err){
							IS_JSON = false;
						}
						if( IS_JSON ){
							var data = json;
						}else{
							var data = res;
						}
					}
					if( data ){
						resolve( data );
					}else{
						reject( false );
					}
				});
			});
		}
	}
};

//	Send message to notification server...
Flybase.prototype.trigger = function(event, message){
	if( typeof message === 'object' ){
		var message = JSON.stringify( message );
	}
	var data = {
		room: this.room,
		event: event,
		message: message
	}
	this.socket.emit("soundout", data);
/*
	var url = this.pushUrl+'/emit/' + this.room +  '/' + event + '/' + message;
	var req = new XMLHttpRequest();
	req.open('GET', url, true);
	req.send(  );
*/
};

Flybase.prototype.emit  = function(event, message) {
	if( typeof message === 'object' ){
		var message = JSON.stringify( message );
	}
	var data = {
		room: this.room,
		event: event,
		message: message
	}
	this.socket.emit("soundout", data);
/*
	var url = this.pushUrl+'/emit/' + this.room +  '/' + event + '/' + message;
	var req = new XMLHttpRequest();
	req.open('GET', url, true);
	req.send(  );
*/
};


Flybase.prototype.listApps = function(callback){
	callback = callback || function(){};
	var endpoint = 'apps';

	this.rget(endpoint, callback);
};

Flybase.prototype.listCollections = function( callback ){
	callback = callback || function(){};
	database = this.database;

	var endpoint = 'apps/'+database+'/collections';

	this.rget(endpoint, callback);
};

/*
	optionalParams (optional) - [q=<query>][&c=true][&f=<fields>][&fo=true][&s=<order>][&sk=<skip>][&l=<limit>]

	example - {c : true, fo : true, l : 500}

	q=<query> - restrict results by the specified JSON query
	c=true - return the result count for this query
	f=<set of fields> - specify the set of fields to include or exclude in each document (1 - include; 0 - exclude)
	fo=true - return a single document from the result set (same as findOne() using the mongo shell
	s=<sort order> - specify the order in which to sort each specified field (1- ascending; -1 - descending)
	sk=<num results to skip> - specify the number of results to skip in the result set; useful for paging
	l=<limit> - specify the limit for the number of results


	callback (optional) - function(){}

*/
Flybase.prototype.get = function(cb,options){
	var self = this;
	if( callback ){
		return self.listDocuments(cb,self.query);
	}else{
		return new Promise(function(resolve, reject) {
			self.listDocuments(function(data){
				if( data.count() ){
					resolve( data );
				}else{
					reject( false );
				}
			},self.query);
		});
	}
};


Flybase.prototype.listDocuments = function(cb,options){
	callback = cb || function(){};
	optionalParams = options || false;
	database = this.database;
	collection = this.collection;

	var endpoint = 'apps/'+database+'/collections/'+collection;
	var params = '';

	if(typeof optionalParams === 'object'){
		for(var i in optionalParams){
			params += '&'+i+'='+JSON.stringify(optionalParams[i]);
		}
	}

	this.rget(endpoint, callback, params);
};

Flybase.prototype.listDocuments2 = function(options, coll, cb){
	callback = cb || function(){};
	optionalParams = options || false;
	database = this.database;
	collection = coll || this.collection;

	var endpoint = 'apps/'+database+'/collections/'+collection;
	var params = '';

	if(typeof optionalParams === 'object'){
		for(var i in optionalParams){
			params += '&'+i+'='+JSON.stringify(optionalParams[i]);
		}
	}
//	console.log( params );
	this.rget(endpoint, callback, params);
};

Flybase.prototype.set = function(data, cb){
	return this.insertDocument(data, cb);
};

Flybase.prototype.push = function(data, cb){
	return this.insertDocument(data, cb);
};

Flybase.prototype.insertDocument = function(data, callback){
	database = this.database;
	collection = this.collection;

	var endpoint = 'apps/'+database+'/collections/'+collection;
	var self = this;
	if( callback ){
		self.rpost(endpoint, data, callback);
	}else{
		return new Promise(function(resolve, reject) {
			self.rpost(endpoint, data, function(data){
				if( data ){
					resolve( data );
				}else{
					reject( false );
				}
			});
		});
	}
};

Flybase.prototype.update = function(id, data, cb){
	this.updateDocument(id, data, cb);
}

Flybase.prototype.updateDocument = function(id, data, callback){
	database = this.database;
	collection = this.collection;

	var endpoint = 'apps/'+database+'/collections/'+collection+'/'+id;
	var self = this;
	if( callback ){
		self.rpost(endpoint, data, callback);
	}else{
		return new Promise(function(resolve, reject) {
			self.rpost(endpoint, data, function(data){
				if( data ){
					resolve( data );
				}else{
					reject( false );
				}
			});
		});
	}
};

Flybase.prototype.remove = function(id, cb){
	this.deleteDocument(id, cb);
};

Flybase.prototype.deleteDocument = function(id, callback){
	database = this.database;
	collection = this.collection;

	var endpoint = 'apps/'+database+'/collections/'+collection+'/'+id;
	var self = this;
	if( callback ){
		self.rdelete(endpoint, callback);
	}else{
		return new Promise(function(resolve, reject) {
			self.rdelete(endpoint, function(data){
				if( data ){
					resolve( data );
				}else{
					reject( false );
				}
			});
		});
	}
};

//	worker queue functions
Flybase.prototype.getLength = function(cb,options){
	callback = cb || function(){};
	optionalParams = options || false;
	database = this.database;
	collection = this.collection;

	var endpoint = 'queue/'+database+'/count';
	var params = '';

	if(typeof optionalParams === 'object'){
		for(var i in optionalParams){
			params += '&'+i+'='+JSON.stringify(optionalParams[i]);
		}
	}

	this.qget(endpoint, callback, params);
};
Flybase.prototype.enqueue = function(data, callback){
	database = this.database;
	collection = this.collection;

	var endpoint = 'queue/'+database;
	var self = this;
	if( callback ){
		self.qpost(endpoint, data, callback);
	}else{
		return new Promise(function(resolve, reject) {
			self.qpost(endpoint, data, function(data){
				if( data ){
					resolve( data );
				}else{
					reject( false );
				}
			});
		});
	}
};
Flybase.prototype.dequeue = function(cb,options){
	callback = cb || function(){};
	optionalParams = options || false;
	database = this.database;
	collection = this.collection;

	var endpoint = 'queue/'+database;
	var params = '';

	if(typeof optionalParams === 'object'){
		for(var i in optionalParams){
			params += '&'+i+'='+JSON.stringify(optionalParams[i]);
		}
	}

	this.qget(endpoint, callback, params);
};

/** Utility methods for making requests **/
Flybase.prototype.rget = function(endpoint, callback, params){

	callback = callback || function(){};
	params = params || '';

	this.request(this.apiUrl+'/'+endpoint+'?apiKey='+this.apiKey+params, 'GET', callback);
};
Flybase.prototype.qget = function(endpoint, callback, params){

	callback = callback || function(){};
	params = params || '';

	this.qrequest(this.apiUrl+'/'+endpoint+'?apiKey='+this.apiKey+params, 'GET', callback);
};
Flybase.prototype.rgetp = function(endpoint, callback, params){

	callback = callback || function(){};
	params = params || '';

	this.request(this.pushUrl+'/'+endpoint+'?apiKey='+this.apiKey+params, 'GET', callback);
};

Flybase.prototype.rpost = function(endpoint, data, callback){

	callback = callback || function(){};
	data = typeof data === 'object' ? data : false;

	this.request(this.apiUrl+'/'+endpoint+'?apiKey='+this.apiKey, 'POST', JSON.stringify(data), callback);
};
Flybase.prototype.qpost = function(endpoint, data, callback){

	callback = callback || function(){};
	data = typeof data === 'object' ? data : false;

	this.qrequest(this.apiUrl+'/'+endpoint+'?apiKey='+this.apiKey, 'POST', JSON.stringify(data), callback);
};
Flybase.prototype.rpostp = function(endpoint, data, callback){

	callback = callback || function(){};
	data = typeof data === 'object' ? data : false;

	this.request(this.pushUrl+'/'+endpoint+'?apiKey='+this.apiKey, 'POST', JSON.stringify(data), callback);
};

Flybase.prototype.rput = function(endpoint, callback, data){

	callback = callback || function(){};
	params = params || '';
	data = typeof data === 'object' ? data : false;

	this.request(this.apiUrl+'/'+endpoint+'?apiKey='+this.apiKey, 'PUT', JSON.stringify(data), callback);
};

Flybase.prototype.rdelete = function(endpoint, callback){

	callback = callback || function(){};

	this.request(this.apiUrl+'/'+endpoint+'?apiKey='+this.apiKey, 'DELETE', callback);
};

var retries = 15;

Flybase.prototype.request = function(url, type){
	var callback = typeof arguments[2] === 'function' ? arguments[2] : (typeof arguments[3] === 'function' ? arguments[3] : function(){});
	data = typeof arguments[2] === 'string' || typeof arguments[2] === 'object' ? arguments[2] : false;

	var timestamp = Math.round(+new Date / 1000);
	var signature = SHA1(this.apiKey + ' ' + data + ' ' + timestamp);
	headers = {
		"X-Requested-With": "XMLHttpRequest",
		"Accept": "application/json;text/plain",
		"X-Flybase-API-Key": this.apiKey,
		"X-Flybase-API-Signature": signature,
		"X-Flybase-API-Timestamp": timestamp
	};

	var self = this;

	function makeReq() {
		fetch(url, {
			method: type,
			body: data,
			headers: headers
		}).then(function(response) {
			if (response.status >= 200 && response.status < 400){
				response.text().then(function(responseText) {
					var res = responseText;
					var data = self.processData( res );
					self.currentItem = data;
					callback( data );
				});
			}else{
				retries--;
				if(retries > 0) {
					this.logger().log("Retrying... " + retries);
					setTimeout(function(){
						makeReq()
					}, 1500);
				} else {
					this.logger().log("No go Joe");
				}
			}
		}, function(error) {
			retries--;
			if(retries > 0) {
				this.logger().log("Retrying... " + retries);
				setTimeout(function(){
					makeReq()
				}, 1500);
			} else {
				this.logger().log(error.message);
			}
		})
	}
	makeReq();

};

Flybase.prototype.qrequest = function(url, type){
	var callback = typeof arguments[2] === 'function' ? arguments[2] : (typeof arguments[3] === 'function' ? arguments[3] : function(){});
	data = typeof arguments[2] === 'string' || typeof arguments[2] === 'object' ? arguments[2] : false;

	var timestamp = Math.round(+new Date / 1000);
	var signature = SHA1(this.apiKey + ' ' + data + ' ' + timestamp);
	headers = {
		"X-Requested-With": "XMLHttpRequest",
		"Accept": "application/json;text/plain",
		"X-Flybase-API-Key": this.apiKey,
		"X-Flybase-API-Signature": signature,
		"X-Flybase-API-Timestamp": timestamp
	};

	var self = this;

	function makeReq() {
		fetch(url, {
			method: type,
			body: data,
			headers: headers
		}).then(function(response) {
			if (response.status >= 200 && response.status < 400){
				response.text().then(function(responseText) {
					var res = responseText;
					var IS_JSON = true;
					try{
						var json = JSON.parse( res );
					}catch(err){
						IS_JSON = false;
					}

					if( IS_JSON ){
						var data = json;
					}else{
						var data = res;
					}
//					var data = self.processData( res );
					self.currentItem = data;
					callback( data );
				});
			}else{
				retries--;
				if(retries > 0) {
					this.logger().log("Retrying... " + retries);
					setTimeout(function(){
						makeReq()
					}, 1500);
				} else {
					this.logger().log("No go Joe");
				}
			}
		}, function(error) {
			retries--;
			if(retries > 0) {
				this.logger().log("Retrying... " + retries);
				setTimeout(function(){
					makeReq()
				}, 1500);
			} else {
				this.logger().log(error.message);
			}
		})
	}
	makeReq();

};


/* transaction is still under development, use at own risk :) */
Flybase.prototype.transaction = function( updateFunction, cb){
	callback = cb || function(){};
	var c = {
		update: updateFunction,
		status: null
	};
	var e = this.currentItem.value();
	var e = e[0];
	var d = c.update( e );
	if ( is_void(d) ) {
		this.logger().log("transaction failed: Data returned " + d);
		c.status = 1;
	}else{
		if( is_object( d ) ){
//			merge the arrays together...
			var k = merge( e, d );
			this.push( k, cb );
		}else{
//			returned null.. so delete...
//			delete the record since it was NULL..
			this.deleteDocument( e._id, cb );
		}
		console.log( d );
	}
};

//	format return values into a object with helper functions...
Flybase.prototype.processData = function ( data ){
	var self = this;
	var retVal = [];
	var raw = data;

	var IS_JSON = true;
	try{
		var json = JSON.parse( data );
	}catch(err){
		IS_JSON = false;
	}

	if( IS_JSON ){
		var toProcess = json;
	}else{
		var toProcess = data;
	}

	if( toProcess == null ){
		var obj = {
			'data': [],
			value : function() {
				return this.data;
			},
			key : function(){
				return this.data._id;
			},
			ref : function(){
				return self;
			}
		};
		var Processed = obj;
	}else if ( !toProcess.length ) {
		//	single variable...
		var obj = {
			'data': toProcess,
			value : function() {
				return this.data;
			},
			key : function(){
				return this.data._id;
			},
			ref : function(){
				return self;
			}
		};
		var Processed = obj;
	}else{
		for (var i in toProcess) {
			var value = toProcess[i];
			var obj = {
				'data': value,
				value : function() {
					return this.data;
				},
				key : function(){
					return this.data._id;
				},
				ref : function(){
					return self;
				}
			};
			retVal[i] = obj;
		}
		var Processed = retVal;
	}

//	single variable...
	var data = {
		'data': Processed,
		'raw': raw,
		export : function() {
			return this.raw;
		},
		value : function() {
			if( this.count() > 1 ){
				return this.data;
			}else{
				return this.data.value();
			}
		},
		key : function(){
			if( this.count() > 1 ){
				return null;
			}else{
				return this.data.key();
			}
		},
		first : function(){
			if( this.count() > 0 ){
				var d = this.data[ 0 ];
				return d;
			}else{
				return this.data;
			}
		},
		count : function(){
			if (typeof this.data.length == 'undefined' ){
				return null;
			}else{
				return this.data.length;
			}
		},
		forEach : function( cb ){
			// iterate through each record returned...
			for (var i in this.data ) {
				var d = this.data[i];
				cb( d );
			}
		},
		ref : function(){
			return self;
		}
	};

	return data;
};

 //	Utility Functions ---------------------------------------------------------------

var hb = function() {
	var a = 1;
	return function() {
		return a++
	}
}();

function is_object(a) {
	var b = typeof a;
	return "object" == b && null != a || "function" == b
}

function is_void(a) {
//	return (typeof a === 'undefined');
	return void 0 === a;
}

function merge() {
	var obj = {}, i = 0, il = arguments.length, key;
	for (; i < il; i++) {
		for (key in arguments[i]) {
			if (arguments[i].hasOwnProperty(key)) {
				obj[key] = arguments[i][key];
			}
		}
	}
	return obj;
};

function mockconsole(){
	var methods = "assert,count,debug,dir,dirxml,error,exception,group,groupCollapsed,groupEnd,info,log,markTimeline,profile,profileEnd,time,timeEnd,trace,warn".split(",");
	var l = methods.length;
	var fn = function () {};
	var mockconsoleObj = {};

	while (l--) {
	    mockconsoleObj[methods[l]] = fn;
	}
	return mockconsoleObj;
}

/****	Socket.io code *******/
!function(t){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=t();else if("function"==typeof define&&define.amd)define([],t);else{var e;"undefined"!=typeof window?e=window:"undefined"!=typeof global?e=global:"undefined"!=typeof self&&(e=self),e.io=t()}}(function(){var t;return function e(t,n,r){function o(s,a){if(!n[s]){if(!t[s]){var c="function"==typeof require&&require;if(!a&&c)return c(s,!0);if(i)return i(s,!0);throw new Error("Cannot find module '"+s+"'")}var p=n[s]={exports:{}};t[s][0].call(p.exports,function(e){var n=t[s][1][e];return o(n?n:e)},p,p.exports,e,t,n,r)}return n[s].exports}for(var i="function"==typeof require&&require,s=0;s<r.length;s++)o(r[s]);return o}({1:[function(t,e,n){e.exports=t("./lib/")},{"./lib/":2}],2:[function(t,e,n){function r(t,e){"object"==typeof t&&(e=t,t=void 0),e=e||{};var n,r=o(t),i=r.source,p=r.id;return e.forceNew||e["force new connection"]||!1===e.multiplex?(a("ignoring socket cache for %s",i),n=s(i,e)):(c[p]||(a("new io instance for %s",i),c[p]=s(i,e)),n=c[p]),n.socket(r.path)}var o=t("./url"),i=t("socket.io-parser"),s=t("./manager"),a=t("debug")("socket.io-client");e.exports=n=r;var c=n.managers={};n.protocol=i.protocol,n.connect=r,n.Manager=t("./manager"),n.Socket=t("./socket")},{"./manager":3,"./socket":5,"./url":6,debug:10,"socket.io-parser":44}],3:[function(t,e,n){function r(t,e){return this instanceof r?(t&&"object"==typeof t&&(e=t,t=void 0),e=e||{},e.path=e.path||"/socket.io",this.nsps={},this.subs=[],this.opts=e,this.reconnection(e.reconnection!==!1),this.reconnectionAttempts(e.reconnectionAttempts||1/0),this.reconnectionDelay(e.reconnectionDelay||1e3),this.reconnectionDelayMax(e.reconnectionDelayMax||5e3),this.randomizationFactor(e.randomizationFactor||.5),this.backoff=new h({min:this.reconnectionDelay(),max:this.reconnectionDelayMax(),jitter:this.randomizationFactor()}),this.timeout(null==e.timeout?2e4:e.timeout),this.readyState="closed",this.uri=t,this.connected=[],this.encoding=!1,this.packetBuffer=[],this.encoder=new a.Encoder,this.decoder=new a.Decoder,this.autoConnect=e.autoConnect!==!1,void(this.autoConnect&&this.open())):new r(t,e)}var o=(t("./url"),t("engine.io-client")),i=t("./socket"),s=t("component-emitter"),a=t("socket.io-parser"),c=t("./on"),p=t("component-bind"),u=(t("object-component"),t("debug")("socket.io-client:manager")),f=t("indexof"),h=t("backo2");e.exports=r,r.prototype.emitAll=function(){this.emit.apply(this,arguments);for(var t in this.nsps)this.nsps[t].emit.apply(this.nsps[t],arguments)},r.prototype.updateSocketIds=function(){for(var t in this.nsps)this.nsps[t].id=this.engine.id},s(r.prototype),r.prototype.reconnection=function(t){return arguments.length?(this._reconnection=!!t,this):this._reconnection},r.prototype.reconnectionAttempts=function(t){return arguments.length?(this._reconnectionAttempts=t,this):this._reconnectionAttempts},r.prototype.reconnectionDelay=function(t){return arguments.length?(this._reconnectionDelay=t,this.backoff&&this.backoff.setMin(t),this):this._reconnectionDelay},r.prototype.randomizationFactor=function(t){return arguments.length?(this._randomizationFactor=t,this.backoff&&this.backoff.setJitter(t),this):this._randomizationFactor},r.prototype.reconnectionDelayMax=function(t){return arguments.length?(this._reconnectionDelayMax=t,this.backoff&&this.backoff.setMax(t),this):this._reconnectionDelayMax},r.prototype.timeout=function(t){return arguments.length?(this._timeout=t,this):this._timeout},r.prototype.maybeReconnectOnOpen=function(){!this.reconnecting&&this._reconnection&&0===this.backoff.attempts&&this.reconnect()},r.prototype.open=r.prototype.connect=function(t){if(u("readyState %s",this.readyState),~this.readyState.indexOf("open"))return this;u("opening %s",this.uri),this.engine=o(this.uri,this.opts);var e=this.engine,n=this;this.readyState="opening",this.skipReconnect=!1;var r=c(e,"open",function(){n.onopen(),t&&t()}),i=c(e,"error",function(e){if(u("connect_error"),n.cleanup(),n.readyState="closed",n.emitAll("connect_error",e),t){var r=new Error("Connection error");r.data=e,t(r)}else n.maybeReconnectOnOpen()});if(!1!==this._timeout){var s=this._timeout;u("connect attempt will timeout after %d",s);var a=setTimeout(function(){u("connect attempt timed out after %d",s),r.destroy(),e.close(),e.emit("error","timeout"),n.emitAll("connect_timeout",s)},s);this.subs.push({destroy:function(){clearTimeout(a)}})}return this.subs.push(r),this.subs.push(i),this},r.prototype.onopen=function(){u("open"),this.cleanup(),this.readyState="open",this.emit("open");var t=this.engine;this.subs.push(c(t,"data",p(this,"ondata"))),this.subs.push(c(this.decoder,"decoded",p(this,"ondecoded"))),this.subs.push(c(t,"error",p(this,"onerror"))),this.subs.push(c(t,"close",p(this,"onclose")))},r.prototype.ondata=function(t){this.decoder.add(t)},r.prototype.ondecoded=function(t){this.emit("packet",t)},r.prototype.onerror=function(t){u("error",t),this.emitAll("error",t)},r.prototype.socket=function(t){var e=this.nsps[t];if(!e){e=new i(this,t),this.nsps[t]=e;var n=this;e.on("connect",function(){e.id=n.engine.id,~f(n.connected,e)||n.connected.push(e)})}return e},r.prototype.destroy=function(t){var e=f(this.connected,t);~e&&this.connected.splice(e,1),this.connected.length||this.close()},r.prototype.packet=function(t){u("writing packet %j",t);var e=this;e.encoding?e.packetBuffer.push(t):(e.encoding=!0,this.encoder.encode(t,function(t){for(var n=0;n<t.length;n++)e.engine.write(t[n]);e.encoding=!1,e.processPacketQueue()}))},r.prototype.processPacketQueue=function(){if(this.packetBuffer.length>0&&!this.encoding){var t=this.packetBuffer.shift();this.packet(t)}},r.prototype.cleanup=function(){for(var t;t=this.subs.shift();)t.destroy();this.packetBuffer=[],this.encoding=!1,this.decoder.destroy()},r.prototype.close=r.prototype.disconnect=function(){this.skipReconnect=!0,this.backoff.reset(),this.readyState="closed",this.engine&&this.engine.close()},r.prototype.onclose=function(t){u("close"),this.cleanup(),this.backoff.reset(),this.readyState="closed",this.emit("close",t),this._reconnection&&!this.skipReconnect&&this.reconnect()},r.prototype.reconnect=function(){if(this.reconnecting||this.skipReconnect)return this;var t=this;if(this.backoff.attempts>=this._reconnectionAttempts)u("reconnect failed"),this.backoff.reset(),this.emitAll("reconnect_failed"),this.reconnecting=!1;else{var e=this.backoff.duration();u("will wait %dms before reconnect attempt",e),this.reconnecting=!0;var n=setTimeout(function(){t.skipReconnect||(u("attempting reconnect"),t.emitAll("reconnect_attempt",t.backoff.attempts),t.emitAll("reconnecting",t.backoff.attempts),t.skipReconnect||t.open(function(e){e?(u("reconnect attempt error"),t.reconnecting=!1,t.reconnect(),t.emitAll("reconnect_error",e.data)):(u("reconnect success"),t.onreconnect())}))},e);this.subs.push({destroy:function(){clearTimeout(n)}})}},r.prototype.onreconnect=function(){var t=this.backoff.attempts;this.reconnecting=!1,this.backoff.reset(),this.updateSocketIds(),this.emitAll("reconnect",t)}},{"./on":4,"./socket":5,"./url":6,backo2:7,"component-bind":8,"component-emitter":9,debug:10,"engine.io-client":11,indexof:40,"object-component":41,"socket.io-parser":44}],4:[function(t,e,n){function r(t,e,n){return t.on(e,n),{destroy:function(){t.removeListener(e,n)}}}e.exports=r},{}],5:[function(t,e,n){function r(t,e){this.io=t,this.nsp=e,this.json=this,this.ids=0,this.acks={},this.io.autoConnect&&this.open(),this.receiveBuffer=[],this.sendBuffer=[],this.connected=!1,this.disconnected=!0}var o=t("socket.io-parser"),i=t("component-emitter"),s=t("to-array"),a=t("./on"),c=t("component-bind"),p=t("debug")("socket.io-client:socket"),u=t("has-binary");e.exports=n=r;var f={connect:1,connect_error:1,connect_timeout:1,disconnect:1,error:1,reconnect:1,reconnect_attempt:1,reconnect_failed:1,reconnect_error:1,reconnecting:1},h=i.prototype.emit;i(r.prototype),r.prototype.subEvents=function(){if(!this.subs){var t=this.io;this.subs=[a(t,"open",c(this,"onopen")),a(t,"packet",c(this,"onpacket")),a(t,"close",c(this,"onclose"))]}},r.prototype.open=r.prototype.connect=function(){return this.connected?this:(this.subEvents(),this.io.open(),"open"==this.io.readyState&&this.onopen(),this)},r.prototype.send=function(){var t=s(arguments);return t.unshift("message"),this.emit.apply(this,t),this},r.prototype.emit=function(t){if(f.hasOwnProperty(t))return h.apply(this,arguments),this;var e=s(arguments),n=o.EVENT;u(e)&&(n=o.BINARY_EVENT);var r={type:n,data:e};return"function"==typeof e[e.length-1]&&(p("emitting packet with ack id %d",this.ids),this.acks[this.ids]=e.pop(),r.id=this.ids++),this.connected?this.packet(r):this.sendBuffer.push(r),this},r.prototype.packet=function(t){t.nsp=this.nsp,this.io.packet(t)},r.prototype.onopen=function(){p("transport is open - connecting"),"/"!=this.nsp&&this.packet({type:o.CONNECT})},r.prototype.onclose=function(t){p("close (%s)",t),this.connected=!1,this.disconnected=!0,delete this.id,this.emit("disconnect",t)},r.prototype.onpacket=function(t){if(t.nsp==this.nsp)switch(t.type){case o.CONNECT:this.onconnect();break;case o.EVENT:this.onevent(t);break;case o.BINARY_EVENT:this.onevent(t);break;case o.ACK:this.onack(t);break;case o.BINARY_ACK:this.onack(t);break;case o.DISCONNECT:this.ondisconnect();break;case o.ERROR:this.emit("error",t.data)}},r.prototype.onevent=function(t){var e=t.data||[];p("emitting event %j",e),null!=t.id&&(p("attaching ack callback to event"),e.push(this.ack(t.id))),this.connected?h.apply(this,e):this.receiveBuffer.push(e)},r.prototype.ack=function(t){var e=this,n=!1;return function(){if(!n){n=!0;var r=s(arguments);p("sending ack %j",r);var i=u(r)?o.BINARY_ACK:o.ACK;e.packet({type:i,id:t,data:r})}}},r.prototype.onack=function(t){p("calling ack %s with %j",t.id,t.data);var e=this.acks[t.id];e.apply(this,t.data),delete this.acks[t.id]},r.prototype.onconnect=function(){this.connected=!0,this.disconnected=!1,this.emit("connect"),this.emitBuffered()},r.prototype.emitBuffered=function(){var t;for(t=0;t<this.receiveBuffer.length;t++)h.apply(this,this.receiveBuffer[t]);for(this.receiveBuffer=[],t=0;t<this.sendBuffer.length;t++)this.packet(this.sendBuffer[t]);this.sendBuffer=[]},r.prototype.ondisconnect=function(){p("server disconnect (%s)",this.nsp),this.destroy(),this.onclose("io server disconnect")},r.prototype.destroy=function(){if(this.subs){for(var t=0;t<this.subs.length;t++)this.subs[t].destroy();this.subs=null}this.io.destroy(this)},r.prototype.close=r.prototype.disconnect=function(){return this.connected&&(p("performing disconnect (%s)",this.nsp),this.packet({type:o.DISCONNECT})),this.destroy(),this.connected&&this.onclose("io client disconnect"),this}},{"./on":4,"component-bind":8,"component-emitter":9,debug:10,"has-binary":36,"socket.io-parser":44,"to-array":48}],6:[function(t,e,n){(function(n){function r(t,e){var r=t,e=e||n.location;return null==t&&(t=e.protocol+"//"+e.host),"string"==typeof t&&("/"==t.charAt(0)&&(t="/"==t.charAt(1)?e.protocol+t:e.hostname+t),/^(https?|wss?):\/\//.test(t)||(i("protocol-less url %s",t),t="undefined"!=typeof e?e.protocol+"//"+t:"https://"+t),i("parse %s",t),r=o(t)),r.port||(/^(http|ws)$/.test(r.protocol)?r.port="80":/^(http|ws)s$/.test(r.protocol)&&(r.port="443")),r.path=r.path||"/",r.id=r.protocol+"://"+r.host+":"+r.port,r.href=r.protocol+"://"+r.host+(e&&e.port==r.port?"":":"+r.port),r}var o=t("parseuri"),i=t("debug")("socket.io-client:url");e.exports=r}).call(this,"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{debug:10,parseuri:42}],7:[function(t,e,n){function r(t){t=t||{},this.ms=t.min||100,this.max=t.max||1e4,this.factor=t.factor||2,this.jitter=t.jitter>0&&t.jitter<=1?t.jitter:0,this.attempts=0}e.exports=r,r.prototype.duration=function(){var t=this.ms*Math.pow(this.factor,this.attempts++);if(this.jitter){var e=Math.random(),n=Math.floor(e*this.jitter*t);t=0==(1&Math.floor(10*e))?t-n:t+n}return 0|Math.min(t,this.max)},r.prototype.reset=function(){this.attempts=0},r.prototype.setMin=function(t){this.ms=t},r.prototype.setMax=function(t){this.max=t},r.prototype.setJitter=function(t){this.jitter=t}},{}],8:[function(t,e,n){var r=[].slice;e.exports=function(t,e){if("string"==typeof e&&(e=t[e]),"function"!=typeof e)throw new Error("bind() requires a function");var n=r.call(arguments,2);return function(){return e.apply(t,n.concat(r.call(arguments)))}}},{}],9:[function(t,e,n){function r(t){return t?o(t):void 0}function o(t){for(var e in r.prototype)t[e]=r.prototype[e];return t}e.exports=r,r.prototype.on=r.prototype.addEventListener=function(t,e){return this._callbacks=this._callbacks||{},(this._callbacks[t]=this._callbacks[t]||[]).push(e),this},r.prototype.once=function(t,e){function n(){r.off(t,n),e.apply(this,arguments)}var r=this;return this._callbacks=this._callbacks||{},n.fn=e,this.on(t,n),this},r.prototype.off=r.prototype.removeListener=r.prototype.removeAllListeners=r.prototype.removeEventListener=function(t,e){if(this._callbacks=this._callbacks||{},0==arguments.length)return this._callbacks={},this;var n=this._callbacks[t];if(!n)return this;if(1==arguments.length)return delete this._callbacks[t],this;for(var r,o=0;o<n.length;o++)if(r=n[o],r===e||r.fn===e){n.splice(o,1);break}return this},r.prototype.emit=function(t){this._callbacks=this._callbacks||{};var e=[].slice.call(arguments,1),n=this._callbacks[t];if(n){n=n.slice(0);for(var r=0,o=n.length;o>r;++r)n[r].apply(this,e)}return this},r.prototype.listeners=function(t){return this._callbacks=this._callbacks||{},this._callbacks[t]||[]},r.prototype.hasListeners=function(t){return!!this.listeners(t).length}},{}],10:[function(t,e,n){function r(t){return r.enabled(t)?function(e){e=o(e);var n=new Date,i=n-(r[t]||n);r[t]=n,e=t+" "+e+" +"+r.humanize(i),window.console&&console.log&&Function.prototype.apply.call(console.log,console,arguments)}:function(){}}function o(t){return t instanceof Error?t.stack||t.message:t}e.exports=r,r.names=[],r.skips=[],r.enable=function(t){try{localStorage.debug=t}catch(e){}for(var n=(t||"").split(/[\s,]+/),o=n.length,i=0;o>i;i++)t=n[i].replace("*",".*?"),"-"===t[0]?r.skips.push(new RegExp("^"+t.substr(1)+"$")):r.names.push(new RegExp("^"+t+"$"))},r.disable=function(){r.enable("")},r.humanize=function(t){var e=1e3,n=6e4,r=60*n;return t>=r?(t/r).toFixed(1)+"h":t>=n?(t/n).toFixed(1)+"m":t>=e?(t/e|0)+"s":t+"ms"},r.enabled=function(t){for(var e=0,n=r.skips.length;n>e;e++)if(r.skips[e].test(t))return!1;for(var e=0,n=r.names.length;n>e;e++)if(r.names[e].test(t))return!0;return!1};try{window.localStorage&&r.enable(localStorage.debug)}catch(i){}},{}],11:[function(t,e,n){e.exports=t("./lib/")},{"./lib/":12}],12:[function(t,e,n){e.exports=t("./socket"),e.exports.parser=t("engine.io-parser")},{"./socket":13,"engine.io-parser":25}],13:[function(t,e,n){(function(n){function r(t,e){if(!(this instanceof r))return new r(t,e);if(e=e||{},t&&"object"==typeof t&&(e=t,t=null),t&&(t=u(t),e.host=t.host,e.secure="https"==t.protocol||"wss"==t.protocol,e.port=t.port,t.query&&(e.query=t.query)),this.secure=null!=e.secure?e.secure:n.location&&"https:"==location.protocol,e.host){var o=e.host.split(":");e.hostname=o.shift(),o.length?e.port=o.pop():e.port||(e.port=this.secure?"443":"80")}this.agent=e.agent||!1,this.hostname=e.hostname||(n.location?location.hostname:"localhost"),this.port=e.port||(n.location&&location.port?location.port:this.secure?443:80),this.query=e.query||{},"string"==typeof this.query&&(this.query=h.decode(this.query)),this.upgrade=!1!==e.upgrade,this.path=(e.path||"/engine.io").replace(/\/$/,"")+"/",this.forceJSONP=!!e.forceJSONP,this.jsonp=!1!==e.jsonp,this.forceBase64=!!e.forceBase64,this.enablesXDR=!!e.enablesXDR,this.timestampParam=e.timestampParam||"t",this.timestampRequests=e.timestampRequests,this.transports=e.transports||["polling","websocket"],this.readyState="",this.writeBuffer=[],this.callbackBuffer=[],this.policyPort=e.policyPort||843,this.rememberUpgrade=e.rememberUpgrade||!1,this.binaryType=null,this.onlyBinaryUpgrades=e.onlyBinaryUpgrades,this.pfx=e.pfx||null,this.key=e.key||null,this.passphrase=e.passphrase||null,this.cert=e.cert||null,this.ca=e.ca||null,this.ciphers=e.ciphers||null,this.rejectUnauthorized=e.rejectUnauthorized||null,this.open()}function o(t){var e={};for(var n in t)t.hasOwnProperty(n)&&(e[n]=t[n]);return e}var i=t("./transports"),s=t("component-emitter"),a=t("debug")("engine.io-client:socket"),c=t("indexof"),p=t("engine.io-parser"),u=t("parseuri"),f=t("parsejson"),h=t("parseqs");e.exports=r,r.priorWebsocketSuccess=!1,s(r.prototype),r.protocol=p.protocol,r.Socket=r,r.Transport=t("./transport"),r.transports=t("./transports"),r.parser=t("engine.io-parser"),r.prototype.createTransport=function(t){a('creating transport "%s"',t);var e=o(this.query);e.EIO=p.protocol,e.transport=t,this.id&&(e.sid=this.id);var n=new i[t]({agent:this.agent,hostname:this.hostname,port:this.port,secure:this.secure,path:this.path,query:e,forceJSONP:this.forceJSONP,jsonp:this.jsonp,forceBase64:this.forceBase64,enablesXDR:this.enablesXDR,timestampRequests:this.timestampRequests,timestampParam:this.timestampParam,policyPort:this.policyPort,socket:this,pfx:this.pfx,key:this.key,passphrase:this.passphrase,cert:this.cert,ca:this.ca,ciphers:this.ciphers,rejectUnauthorized:this.rejectUnauthorized});return n},r.prototype.open=function(){var t;if(this.rememberUpgrade&&r.priorWebsocketSuccess&&-1!=this.transports.indexOf("websocket"))t="websocket";else{if(0==this.transports.length){var e=this;return void setTimeout(function(){e.emit("error","No transports available")},0)}t=this.transports[0]}this.readyState="opening";var t;try{t=this.createTransport(t)}catch(n){return this.transports.shift(),void this.open()}t.open(),this.setTransport(t)},r.prototype.setTransport=function(t){a("setting transport %s",t.name);var e=this;this.transport&&(a("clearing existing transport %s",this.transport.name),this.transport.removeAllListeners()),this.transport=t,t.on("drain",function(){e.onDrain()}).on("packet",function(t){e.onPacket(t)}).on("error",function(t){e.onError(t)}).on("close",function(){e.onClose("transport close")})},r.prototype.probe=function(t){function e(){if(h.onlyBinaryUpgrades){var e=!this.supportsBinary&&h.transport.supportsBinary;f=f||e}f||(a('probe transport "%s" opened',t),u.send([{type:"ping",data:"probe"}]),u.once("packet",function(e){if(!f)if("pong"==e.type&&"probe"==e.data){if(a('probe transport "%s" pong',t),h.upgrading=!0,h.emit("upgrading",u),!u)return;r.priorWebsocketSuccess="websocket"==u.name,a('pausing current transport "%s"',h.transport.name),h.transport.pause(function(){f||"closed"!=h.readyState&&(a("changing transport and sending upgrade packet"),p(),h.setTransport(u),u.send([{type:"upgrade"}]),h.emit("upgrade",u),u=null,h.upgrading=!1,h.flush())})}else{a('probe transport "%s" failed',t);var n=new Error("probe error");n.transport=u.name,h.emit("upgradeError",n)}}))}function n(){f||(f=!0,p(),u.close(),u=null)}function o(e){var r=new Error("probe error: "+e);r.transport=u.name,n(),a('probe transport "%s" failed because of error: %s',t,e),h.emit("upgradeError",r)}function i(){o("transport closed")}function s(){o("socket closed")}function c(t){u&&t.name!=u.name&&(a('"%s" works - aborting "%s"',t.name,u.name),n())}function p(){u.removeListener("open",e),u.removeListener("error",o),u.removeListener("close",i),h.removeListener("close",s),h.removeListener("upgrading",c)}a('probing transport "%s"',t);var u=this.createTransport(t,{probe:1}),f=!1,h=this;r.priorWebsocketSuccess=!1,u.once("open",e),u.once("error",o),u.once("close",i),this.once("close",s),this.once("upgrading",c),u.open()},r.prototype.onOpen=function(){if(a("socket open"),this.readyState="open",r.priorWebsocketSuccess="websocket"==this.transport.name,this.emit("open"),this.flush(),"open"==this.readyState&&this.upgrade&&this.transport.pause){a("starting upgrade probes");for(var t=0,e=this.upgrades.length;e>t;t++)this.probe(this.upgrades[t])}},r.prototype.onPacket=function(t){if("opening"==this.readyState||"open"==this.readyState)switch(a('socket receive: type "%s", data "%s"',t.type,t.data),this.emit("packet",t),this.emit("heartbeat"),t.type){case"open":this.onHandshake(f(t.data));break;case"pong":this.setPing();break;case"error":var e=new Error("server error");e.code=t.data,this.emit("error",e);break;case"message":this.emit("data",t.data),this.emit("message",t.data)}else a('packet received with socket readyState "%s"',this.readyState)},r.prototype.onHandshake=function(t){this.emit("handshake",t),this.id=t.sid,this.transport.query.sid=t.sid,this.upgrades=this.filterUpgrades(t.upgrades),this.pingInterval=t.pingInterval,this.pingTimeout=t.pingTimeout,this.onOpen(),"closed"!=this.readyState&&(this.setPing(),this.removeListener("heartbeat",this.onHeartbeat),this.on("heartbeat",this.onHeartbeat))},r.prototype.onHeartbeat=function(t){clearTimeout(this.pingTimeoutTimer);var e=this;e.pingTimeoutTimer=setTimeout(function(){"closed"!=e.readyState&&e.onClose("ping timeout")},t||e.pingInterval+e.pingTimeout)},r.prototype.setPing=function(){var t=this;clearTimeout(t.pingIntervalTimer),t.pingIntervalTimer=setTimeout(function(){a("writing ping packet - expecting pong within %sms",t.pingTimeout),t.ping(),t.onHeartbeat(t.pingTimeout)},t.pingInterval)},r.prototype.ping=function(){this.sendPacket("ping")},r.prototype.onDrain=function(){for(var t=0;t<this.prevBufferLen;t++)this.callbackBuffer[t]&&this.callbackBuffer[t]();this.writeBuffer.splice(0,this.prevBufferLen),this.callbackBuffer.splice(0,this.prevBufferLen),this.prevBufferLen=0,0==this.writeBuffer.length?this.emit("drain"):this.flush()},r.prototype.flush=function(){"closed"!=this.readyState&&this.transport.writable&&!this.upgrading&&this.writeBuffer.length&&(a("flushing %d packets in socket",this.writeBuffer.length),this.transport.send(this.writeBuffer),this.prevBufferLen=this.writeBuffer.length,this.emit("flush"))},r.prototype.write=r.prototype.send=function(t,e){return this.sendPacket("message",t,e),this},r.prototype.sendPacket=function(t,e,n){if("closing"!=this.readyState&&"closed"!=this.readyState){var r={type:t,data:e};this.emit("packetCreate",r),this.writeBuffer.push(r),this.callbackBuffer.push(n),this.flush()}},r.prototype.close=function(){function t(){r.onClose("forced close"),a("socket closing - telling transport to close"),r.transport.close()}function e(){r.removeListener("upgrade",e),r.removeListener("upgradeError",e),t()}function n(){r.once("upgrade",e),r.once("upgradeError",e)}if("opening"==this.readyState||"open"==this.readyState){this.readyState="closing";var r=this;this.writeBuffer.length?this.once("drain",function(){this.upgrading?n():t()}):this.upgrading?n():t()}return this},r.prototype.onError=function(t){a("socket error %j",t),r.priorWebsocketSuccess=!1,this.emit("error",t),this.onClose("transport error",t)},r.prototype.onClose=function(t,e){if("opening"==this.readyState||"open"==this.readyState||"closing"==this.readyState){a('socket close with reason: "%s"',t);var n=this;clearTimeout(this.pingIntervalTimer),clearTimeout(this.pingTimeoutTimer),setTimeout(function(){n.writeBuffer=[],n.callbackBuffer=[],n.prevBufferLen=0},0),this.transport.removeAllListeners("close"),this.transport.close(),this.transport.removeAllListeners(),this.readyState="closed",this.id=null,this.emit("close",t,e)}},r.prototype.filterUpgrades=function(t){for(var e=[],n=0,r=t.length;r>n;n++)~c(this.transports,t[n])&&e.push(t[n]);return e}}).call(this,"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{"./transport":14,"./transports":15,"component-emitter":9,debug:22,"engine.io-parser":25,indexof:40,parsejson:32,parseqs:33,parseuri:34}],14:[function(t,e,n){function r(t){this.path=t.path,this.hostname=t.hostname,this.port=t.port,this.secure=t.secure,this.query=t.query,this.timestampParam=t.timestampParam,this.timestampRequests=t.timestampRequests,this.readyState="",this.agent=t.agent||!1,this.socket=t.socket,this.enablesXDR=t.enablesXDR,this.pfx=t.pfx,this.key=t.key,this.passphrase=t.passphrase,this.cert=t.cert,this.ca=t.ca,this.ciphers=t.ciphers,this.rejectUnauthorized=t.rejectUnauthorized}var o=t("engine.io-parser"),i=t("component-emitter");e.exports=r,i(r.prototype),r.timestamps=0,r.prototype.onError=function(t,e){var n=new Error(t);return n.type="TransportError",n.description=e,this.emit("error",n),this},r.prototype.open=function(){return("closed"==this.readyState||""==this.readyState)&&(this.readyState="opening",this.doOpen()),this},r.prototype.close=function(){return("opening"==this.readyState||"open"==this.readyState)&&(this.doClose(),this.onClose()),this},r.prototype.send=function(t){if("open"!=this.readyState)throw new Error("Transport not open");this.write(t)},r.prototype.onOpen=function(){this.readyState="open",this.writable=!0,this.emit("open")},r.prototype.onData=function(t){var e=o.decodePacket(t,this.socket.binaryType);this.onPacket(e)},r.prototype.onPacket=function(t){this.emit("packet",t)},r.prototype.onClose=function(){this.readyState="closed",this.emit("close")}},{"component-emitter":9,"engine.io-parser":25}],15:[function(t,e,n){(function(e){function r(t){var n,r=!1,a=!1,c=!1!==t.jsonp;if(e.location){var p="https:"==location.protocol,u=location.port;u||(u=p?443:80),r=t.hostname!=location.hostname||u!=t.port,a=t.secure!=p}if(t.xdomain=r,t.xscheme=a,n=new o(t),"open"in n&&!t.forceJSONP)return new i(t);if(!c)throw new Error("JSONP disabled");return new s(t)}var o=t("xmlhttprequest"),i=t("./polling-xhr"),s=t("./polling-jsonp"),a=t("./websocket");n.polling=r,n.websocket=a}).call(this,"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{"./polling-jsonp":16,"./polling-xhr":17,"./websocket":19,xmlhttprequest:20}],16:[function(t,e,n){(function(n){function r(){}function o(t){i.call(this,t),this.query=this.query||{},a||(n.___eio||(n.___eio=[]),a=n.___eio),this.index=a.length;var e=this;a.push(function(t){e.onData(t)}),this.query.j=this.index,n.document&&n.addEventListener&&n.addEventListener("beforeunload",function(){e.script&&(e.script.onerror=r)},!1)}var i=t("./polling"),s=t("component-inherit");e.exports=o;var a,c=/\n/g,p=/\\n/g;s(o,i),o.prototype.supportsBinary=!1,o.prototype.doClose=function(){this.script&&(this.script.parentNode.removeChild(this.script),this.script=null),this.form&&(this.form.parentNode.removeChild(this.form),this.form=null,this.iframe=null),i.prototype.doClose.call(this)},o.prototype.doPoll=function(){var t=this,e=document.createElement("script");this.script&&(this.script.parentNode.removeChild(this.script),this.script=null),e.async=!0,e.src=this.uri(),e.onerror=function(e){t.onError("jsonp poll error",e)};var n=document.getElementsByTagName("script")[0];n.parentNode.insertBefore(e,n),this.script=e;var r="undefined"!=typeof navigator&&/gecko/i.test(navigator.userAgent);r&&setTimeout(function(){var t=document.createElement("iframe");document.body.appendChild(t),document.body.removeChild(t)},100)},o.prototype.doWrite=function(t,e){function n(){r(),e()}function r(){if(o.iframe)try{o.form.removeChild(o.iframe)}catch(t){o.onError("jsonp polling iframe removal error",t)}try{var e='<iframe src="javascript:0" name="'+o.iframeId+'">';i=document.createElement(e)}catch(t){i=document.createElement("iframe"),i.name=o.iframeId,i.src="javascript:0"}i.id=o.iframeId,o.form.appendChild(i),o.iframe=i}var o=this;if(!this.form){var i,s=document.createElement("form"),a=document.createElement("textarea"),u=this.iframeId="eio_iframe_"+this.index;s.className="socketio",s.style.position="absolute",s.style.top="-1000px",s.style.left="-1000px",s.target=u,s.method="POST",s.setAttribute("accept-charset","utf-8"),a.name="d",s.appendChild(a),document.body.appendChild(s),this.form=s,this.area=a}this.form.action=this.uri(),r(),t=t.replace(p,"\\\n"),this.area.value=t.replace(c,"\\n");try{this.form.submit()}catch(f){}this.iframe.attachEvent?this.iframe.onreadystatechange=function(){"complete"==o.iframe.readyState&&n()}:this.iframe.onload=n}}).call(this,"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{"./polling":18,"component-inherit":21}],17:[function(t,e,n){(function(n){function r(){}function o(t){if(c.call(this,t),n.location){var e="https:"==location.protocol,r=location.port;r||(r=e?443:80),this.xd=t.hostname!=n.location.hostname||r!=t.port,this.xs=t.secure!=e}}function i(t){this.method=t.method||"GET",this.uri=t.uri,this.xd=!!t.xd,this.xs=!!t.xs,this.async=!1!==t.async,this.data=void 0!=t.data?t.data:null,this.agent=t.agent,this.isBinary=t.isBinary,this.supportsBinary=t.supportsBinary,this.enablesXDR=t.enablesXDR,this.pfx=t.pfx,this.key=t.key,this.passphrase=t.passphrase,this.cert=t.cert,this.ca=t.ca,this.ciphers=t.ciphers,this.rejectUnauthorized=t.rejectUnauthorized,this.create()}function s(){for(var t in i.requests)i.requests.hasOwnProperty(t)&&i.requests[t].abort()}var a=t("xmlhttprequest"),c=t("./polling"),p=t("component-emitter"),u=t("component-inherit"),f=t("debug")("engine.io-client:polling-xhr");e.exports=o,e.exports.Request=i,u(o,c),o.prototype.supportsBinary=!0,o.prototype.request=function(t){return t=t||{},t.uri=this.uri(),t.xd=this.xd,t.xs=this.xs,t.agent=this.agent||!1,t.supportsBinary=this.supportsBinary,t.enablesXDR=this.enablesXDR,t.pfx=this.pfx,t.key=this.key,t.passphrase=this.passphrase,t.cert=this.cert,t.ca=this.ca,t.ciphers=this.ciphers,t.rejectUnauthorized=this.rejectUnauthorized,new i(t)},o.prototype.doWrite=function(t,e){var n="string"!=typeof t&&void 0!==t,r=this.request({method:"POST",data:t,isBinary:n}),o=this;r.on("success",e),r.on("error",function(t){o.onError("xhr post error",t)}),this.sendXhr=r},o.prototype.doPoll=function(){f("xhr poll");var t=this.request(),e=this;t.on("data",function(t){e.onData(t)}),t.on("error",function(t){e.onError("xhr poll error",t)}),this.pollXhr=t},p(i.prototype),i.prototype.create=function(){var t={agent:this.agent,xdomain:this.xd,xscheme:this.xs,enablesXDR:this.enablesXDR};t.pfx=this.pfx,t.key=this.key,t.passphrase=this.passphrase,t.cert=this.cert,t.ca=this.ca,t.ciphers=this.ciphers,t.rejectUnauthorized=this.rejectUnauthorized;var e=this.xhr=new a(t),r=this;try{if(f("xhr open %s: %s",this.method,this.uri),e.open(this.method,this.uri,this.async),this.supportsBinary&&(e.responseType="arraybuffer"),"POST"==this.method)try{this.isBinary?e.setRequestHeader("Content-type","application/octet-stream"):e.setRequestHeader("Content-type","text/plain;charset=UTF-8")}catch(o){}"withCredentials"in e&&(e.withCredentials=!0),this.hasXDR()?(e.onload=function(){r.onLoad()},e.onerror=function(){r.onError(e.responseText)}):e.onreadystatechange=function(){4==e.readyState&&(200==e.status||1223==e.status?r.onLoad():setTimeout(function(){r.onError(e.status)},0))},f("xhr data %s",this.data),e.send(this.data)}catch(o){return void setTimeout(function(){r.onError(o)},0)}n.document&&(this.index=i.requestsCount++,i.requests[this.index]=this)},i.prototype.onSuccess=function(){this.emit("success"),this.cleanup()},i.prototype.onData=function(t){this.emit("data",t),this.onSuccess()},i.prototype.onError=function(t){this.emit("error",t),this.cleanup(!0)},i.prototype.cleanup=function(t){if("undefined"!=typeof this.xhr&&null!==this.xhr){if(this.hasXDR()?this.xhr.onload=this.xhr.onerror=r:this.xhr.onreadystatechange=r,t)try{this.xhr.abort()}catch(e){}n.document&&delete i.requests[this.index],this.xhr=null}},i.prototype.onLoad=function(){var t;try{var e;try{e=this.xhr.getResponseHeader("Content-Type").split(";")[0]}catch(n){}t="application/octet-stream"===e?this.xhr.response:this.supportsBinary?"ok":this.xhr.responseText}catch(n){this.onError(n)}null!=t&&this.onData(t)},i.prototype.hasXDR=function(){return"undefined"!=typeof n.XDomainRequest&&!this.xs&&this.enablesXDR},i.prototype.abort=function(){this.cleanup()},n.document&&(i.requestsCount=0,i.requests={},n.attachEvent?n.attachEvent("onunload",s):n.addEventListener&&n.addEventListener("beforeunload",s,!1))}).call(this,"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{"./polling":18,"component-emitter":9,
"component-inherit":21,debug:22,xmlhttprequest:20}],18:[function(t,e,n){function r(t){var e=t&&t.forceBase64;(!p||e)&&(this.supportsBinary=!1),o.call(this,t)}var o=t("../transport"),i=t("parseqs"),s=t("engine.io-parser"),a=t("component-inherit"),c=t("debug")("engine.io-client:polling");e.exports=r;var p=function(){var e=t("xmlhttprequest"),n=new e({xdomain:!1});return null!=n.responseType}();a(r,o),r.prototype.name="polling",r.prototype.doOpen=function(){this.poll()},r.prototype.pause=function(t){function e(){c("paused"),n.readyState="paused",t()}var n=this;if(this.readyState="pausing",this.polling||!this.writable){var r=0;this.polling&&(c("we are currently polling - waiting to pause"),r++,this.once("pollComplete",function(){c("pre-pause polling complete"),--r||e()})),this.writable||(c("we are currently writing - waiting to pause"),r++,this.once("drain",function(){c("pre-pause writing complete"),--r||e()}))}else e()},r.prototype.poll=function(){c("polling"),this.polling=!0,this.doPoll(),this.emit("poll")},r.prototype.onData=function(t){var e=this;c("polling got data %s",t);var n=function(t,n,r){return"opening"==e.readyState&&e.onOpen(),"close"==t.type?(e.onClose(),!1):void e.onPacket(t)};s.decodePayload(t,this.socket.binaryType,n),"closed"!=this.readyState&&(this.polling=!1,this.emit("pollComplete"),"open"==this.readyState?this.poll():c('ignoring poll - transport state "%s"',this.readyState))},r.prototype.doClose=function(){function t(){c("writing close packet"),e.write([{type:"close"}])}var e=this;"open"==this.readyState?(c("transport open - closing"),t()):(c("transport not open - deferring close"),this.once("open",t))},r.prototype.write=function(t){var e=this;this.writable=!1;var n=function(){e.writable=!0,e.emit("drain")},e=this;s.encodePayload(t,this.supportsBinary,function(t){e.doWrite(t,n)})},r.prototype.uri=function(){var t=this.query||{},e=this.secure?"https":"http",n="";return!1!==this.timestampRequests&&(t[this.timestampParam]=+new Date+"-"+o.timestamps++),this.supportsBinary||t.sid||(t.b64=1),t=i.encode(t),this.port&&("https"==e&&443!=this.port||"http"==e&&80!=this.port)&&(n=":"+this.port),t.length&&(t="?"+t),e+"://"+this.hostname+n+this.path+t}},{"../transport":14,"component-inherit":21,debug:22,"engine.io-parser":25,parseqs:33,xmlhttprequest:20}],19:[function(t,e,n){function r(t){var e=t&&t.forceBase64;e&&(this.supportsBinary=!1),o.call(this,t)}var o=t("../transport"),i=t("engine.io-parser"),s=t("parseqs"),a=t("component-inherit"),c=t("debug")("engine.io-client:websocket"),p=t("ws");e.exports=r,a(r,o),r.prototype.name="websocket",r.prototype.supportsBinary=!0,r.prototype.doOpen=function(){if(this.check()){var t=this.uri(),e=void 0,n={agent:this.agent};n.pfx=this.pfx,n.key=this.key,n.passphrase=this.passphrase,n.cert=this.cert,n.ca=this.ca,n.ciphers=this.ciphers,n.rejectUnauthorized=this.rejectUnauthorized,this.ws=new p(t,e,n),void 0===this.ws.binaryType&&(this.supportsBinary=!1),this.ws.binaryType="arraybuffer",this.addEventListeners()}},r.prototype.addEventListeners=function(){var t=this;this.ws.onopen=function(){t.onOpen()},this.ws.onclose=function(){t.onClose()},this.ws.onmessage=function(e){t.onData(e.data)},this.ws.onerror=function(e){t.onError("websocket error",e)}},"undefined"!=typeof navigator&&/iPad|iPhone|iPod/i.test(navigator.userAgent)&&(r.prototype.onData=function(t){var e=this;setTimeout(function(){o.prototype.onData.call(e,t)},0)}),r.prototype.write=function(t){function e(){n.writable=!0,n.emit("drain")}var n=this;this.writable=!1;for(var r=0,o=t.length;o>r;r++)i.encodePacket(t[r],this.supportsBinary,function(t){try{n.ws.send(t)}catch(e){c("websocket closed before onclose event")}});setTimeout(e,0)},r.prototype.onClose=function(){o.prototype.onClose.call(this)},r.prototype.doClose=function(){"undefined"!=typeof this.ws&&this.ws.close()},r.prototype.uri=function(){var t=this.query||{},e=this.secure?"wss":"ws",n="";return this.port&&("wss"==e&&443!=this.port||"ws"==e&&80!=this.port)&&(n=":"+this.port),this.timestampRequests&&(t[this.timestampParam]=+new Date),this.supportsBinary||(t.b64=1),t=s.encode(t),t.length&&(t="?"+t),e+"://"+this.hostname+n+this.path+t},r.prototype.check=function(){return!(!p||"__initialize"in p&&this.name===r.prototype.name)}},{"../transport":14,"component-inherit":21,debug:22,"engine.io-parser":25,parseqs:33,ws:35}],20:[function(t,e,n){var r=t("has-cors");e.exports=function(t){var e=t.xdomain,n=t.xscheme,o=t.enablesXDR;try{if("undefined"!=typeof XMLHttpRequest&&(!e||r))return new XMLHttpRequest}catch(i){}try{if("undefined"!=typeof XDomainRequest&&!n&&o)return new XDomainRequest}catch(i){}if(!e)try{return new ActiveXObject("Microsoft.XMLHTTP")}catch(i){}}},{"has-cors":38}],21:[function(t,e,n){e.exports=function(t,e){var n=function(){};n.prototype=e.prototype,t.prototype=new n,t.prototype.constructor=t}},{}],22:[function(t,e,n){function r(){return"WebkitAppearance"in document.documentElement.style||window.console&&(console.firebug||console.exception&&console.table)||navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)&&parseInt(RegExp.$1,10)>=31}function o(){var t=arguments,e=this.useColors;if(t[0]=(e?"%c":"")+this.namespace+(e?" %c":" ")+t[0]+(e?"%c ":" ")+"+"+n.humanize(this.diff),!e)return t;var r="color: "+this.color;t=[t[0],r,"color: inherit"].concat(Array.prototype.slice.call(t,1));var o=0,i=0;return t[0].replace(/%[a-z%]/g,function(t){"%%"!==t&&(o++,"%c"===t&&(i=o))}),t.splice(i,0,r),t}function i(){return"object"==typeof console&&"function"==typeof console.log&&Function.prototype.apply.call(console.log,console,arguments)}function s(t){try{null==t?localStorage.removeItem("debug"):localStorage.debug=t}catch(e){}}function a(){var t;try{t=localStorage.debug}catch(e){}return t}n=e.exports=t("./debug"),n.log=i,n.formatArgs=o,n.save=s,n.load=a,n.useColors=r,n.colors=["lightseagreen","forestgreen","goldenrod","dodgerblue","darkorchid","crimson"],n.formatters.j=function(t){return JSON.stringify(t)},n.enable(a())},{"./debug":23}],23:[function(t,e,n){function r(){return n.colors[u++%n.colors.length]}function o(t){function e(){}function o(){var t=o,e=+new Date,i=e-(p||e);t.diff=i,t.prev=p,t.curr=e,p=e,null==t.useColors&&(t.useColors=n.useColors()),null==t.color&&t.useColors&&(t.color=r());var s=Array.prototype.slice.call(arguments);s[0]=n.coerce(s[0]),"string"!=typeof s[0]&&(s=["%o"].concat(s));var a=0;s[0]=s[0].replace(/%([a-z%])/g,function(e,r){if("%%"===e)return e;a++;var o=n.formatters[r];if("function"==typeof o){var i=s[a];e=o.call(t,i),s.splice(a,1),a--}return e}),"function"==typeof n.formatArgs&&(s=n.formatArgs.apply(t,s));var c=o.log||n.log||console.log.bind(console);c.apply(t,s)}e.enabled=!1,o.enabled=!0;var i=n.enabled(t)?o:e;return i.namespace=t,i}function i(t){n.save(t);for(var e=(t||"").split(/[\s,]+/),r=e.length,o=0;r>o;o++)e[o]&&(t=e[o].replace(/\*/g,".*?"),"-"===t[0]?n.skips.push(new RegExp("^"+t.substr(1)+"$")):n.names.push(new RegExp("^"+t+"$")))}function s(){n.enable("")}function a(t){var e,r;for(e=0,r=n.skips.length;r>e;e++)if(n.skips[e].test(t))return!1;for(e=0,r=n.names.length;r>e;e++)if(n.names[e].test(t))return!0;return!1}function c(t){return t instanceof Error?t.stack||t.message:t}n=e.exports=o,n.coerce=c,n.disable=s,n.enable=i,n.enabled=a,n.humanize=t("ms"),n.names=[],n.skips=[],n.formatters={};var p,u=0},{ms:24}],24:[function(t,e,n){function r(t){var e=/^((?:\d+)?\.?\d+) *(ms|seconds?|s|minutes?|m|hours?|h|days?|d|years?|y)?$/i.exec(t);if(e){var n=parseFloat(e[1]),r=(e[2]||"ms").toLowerCase();switch(r){case"years":case"year":case"y":return n*f;case"days":case"day":case"d":return n*u;case"hours":case"hour":case"h":return n*p;case"minutes":case"minute":case"m":return n*c;case"seconds":case"second":case"s":return n*a;case"ms":return n}}}function o(t){return t>=u?Math.round(t/u)+"d":t>=p?Math.round(t/p)+"h":t>=c?Math.round(t/c)+"m":t>=a?Math.round(t/a)+"s":t+"ms"}function i(t){return s(t,u,"day")||s(t,p,"hour")||s(t,c,"minute")||s(t,a,"second")||t+" ms"}function s(t,e,n){return e>t?void 0:1.5*e>t?Math.floor(t/e)+" "+n:Math.ceil(t/e)+" "+n+"s"}var a=1e3,c=60*a,p=60*c,u=24*p,f=365.25*u;e.exports=function(t,e){return e=e||{},"string"==typeof t?r(t):e["long"]?i(t):o(t)}},{}],25:[function(t,e,n){(function(e){function r(t,e){var r="b"+n.packets[t.type]+t.data.data;return e(r)}function o(t,e,r){if(!e)return n.encodeBase64Packet(t,r);var o=t.data,i=new Uint8Array(o),s=new Uint8Array(1+o.byteLength);s[0]=m[t.type];for(var a=0;a<i.length;a++)s[a+1]=i[a];return r(s.buffer)}function i(t,e,r){if(!e)return n.encodeBase64Packet(t,r);var o=new FileReader;return o.onload=function(){t.data=o.result,n.encodePacket(t,e,!0,r)},o.readAsArrayBuffer(t.data)}function s(t,e,r){if(!e)return n.encodeBase64Packet(t,r);if(g)return i(t,e,r);var o=new Uint8Array(1);o[0]=m[t.type];var s=new w([o.buffer,t.data]);return r(s)}function a(t,e,n){for(var r=new Array(t.length),o=h(t.length,n),i=function(t,n,o){e(n,function(e,n){r[t]=n,o(e,r)})},s=0;s<t.length;s++)i(s,t[s],o)}var c=t("./keys"),p=t("has-binary"),u=t("arraybuffer.slice"),f=t("base64-arraybuffer"),h=t("after"),l=t("utf8"),d=navigator.userAgent.match(/Android/i),y=/PhantomJS/i.test(navigator.userAgent),g=d||y;n.protocol=3;var m=n.packets={open:0,close:1,ping:2,pong:3,message:4,upgrade:5,noop:6},v=c(m),b={type:"error",data:"parser error"},w=t("blob");n.encodePacket=function(t,n,i,a){"function"==typeof n&&(a=n,n=!1),"function"==typeof i&&(a=i,i=null);var c=void 0===t.data?void 0:t.data.buffer||t.data;if(e.ArrayBuffer&&c instanceof ArrayBuffer)return o(t,n,a);if(w&&c instanceof e.Blob)return s(t,n,a);if(c&&c.base64)return r(t,a);var p=m[t.type];return void 0!==t.data&&(p+=i?l.encode(String(t.data)):String(t.data)),a(""+p)},n.encodeBase64Packet=function(t,r){var o="b"+n.packets[t.type];if(w&&t.data instanceof w){var i=new FileReader;return i.onload=function(){var t=i.result.split(",")[1];r(o+t)},i.readAsDataURL(t.data)}var s;try{s=String.fromCharCode.apply(null,new Uint8Array(t.data))}catch(a){for(var c=new Uint8Array(t.data),p=new Array(c.length),u=0;u<c.length;u++)p[u]=c[u];s=String.fromCharCode.apply(null,p)}return o+=e.btoa(s),r(o)},n.decodePacket=function(t,e,r){if("string"==typeof t||void 0===t){if("b"==t.charAt(0))return n.decodeBase64Packet(t.substr(1),e);if(r)try{t=l.decode(t)}catch(o){return b}var i=t.charAt(0);return Number(i)==i&&v[i]?t.length>1?{type:v[i],data:t.substring(1)}:{type:v[i]}:b}var s=new Uint8Array(t),i=s[0],a=u(t,1);return w&&"blob"===e&&(a=new w([a])),{type:v[i],data:a}},n.decodeBase64Packet=function(t,n){var r=v[t.charAt(0)];if(!e.ArrayBuffer)return{type:r,data:{base64:!0,data:t.substr(1)}};var o=f.decode(t.substr(1));return"blob"===n&&w&&(o=new w([o])),{type:r,data:o}},n.encodePayload=function(t,e,r){function o(t){return t.length+":"+t}function i(t,r){n.encodePacket(t,s?e:!1,!0,function(t){r(null,o(t))})}"function"==typeof e&&(r=e,e=null);var s=p(t);return e&&s?w&&!g?n.encodePayloadAsBlob(t,r):n.encodePayloadAsArrayBuffer(t,r):t.length?void a(t,i,function(t,e){return r(e.join(""))}):r("0:")},n.decodePayload=function(t,e,r){if("string"!=typeof t)return n.decodePayloadAsBinary(t,e,r);"function"==typeof e&&(r=e,e=null);var o;if(""==t)return r(b,0,1);for(var i,s,a="",c=0,p=t.length;p>c;c++){var u=t.charAt(c);if(":"!=u)a+=u;else{if(""==a||a!=(i=Number(a)))return r(b,0,1);if(s=t.substr(c+1,i),a!=s.length)return r(b,0,1);if(s.length){if(o=n.decodePacket(s,e,!0),b.type==o.type&&b.data==o.data)return r(b,0,1);var f=r(o,c+i,p);if(!1===f)return}c+=i,a=""}}return""!=a?r(b,0,1):void 0},n.encodePayloadAsArrayBuffer=function(t,e){function r(t,e){n.encodePacket(t,!0,!0,function(t){return e(null,t)})}return t.length?void a(t,r,function(t,n){var r=n.reduce(function(t,e){var n;return n="string"==typeof e?e.length:e.byteLength,t+n.toString().length+n+2},0),o=new Uint8Array(r),i=0;return n.forEach(function(t){var e="string"==typeof t,n=t;if(e){for(var r=new Uint8Array(t.length),s=0;s<t.length;s++)r[s]=t.charCodeAt(s);n=r.buffer}e?o[i++]=0:o[i++]=1;for(var a=n.byteLength.toString(),s=0;s<a.length;s++)o[i++]=parseInt(a[s]);o[i++]=255;for(var r=new Uint8Array(n),s=0;s<r.length;s++)o[i++]=r[s]}),e(o.buffer)}):e(new ArrayBuffer(0))},n.encodePayloadAsBlob=function(t,e){function r(t,e){n.encodePacket(t,!0,!0,function(t){var n=new Uint8Array(1);if(n[0]=1,"string"==typeof t){for(var r=new Uint8Array(t.length),o=0;o<t.length;o++)r[o]=t.charCodeAt(o);t=r.buffer,n[0]=0}for(var i=t instanceof ArrayBuffer?t.byteLength:t.size,s=i.toString(),a=new Uint8Array(s.length+1),o=0;o<s.length;o++)a[o]=parseInt(s[o]);if(a[s.length]=255,w){var c=new w([n.buffer,a.buffer,t]);e(null,c)}})}a(t,r,function(t,n){return e(new w(n))})},n.decodePayloadAsBinary=function(t,e,r){"function"==typeof e&&(r=e,e=null);for(var o=t,i=[],s=!1;o.byteLength>0;){for(var a=new Uint8Array(o),c=0===a[0],p="",f=1;255!=a[f];f++){if(p.length>310){s=!0;break}p+=a[f]}if(s)return r(b,0,1);o=u(o,2+p.length),p=parseInt(p);var h=u(o,0,p);if(c)try{h=String.fromCharCode.apply(null,new Uint8Array(h))}catch(l){var d=new Uint8Array(h);h="";for(var f=0;f<d.length;f++)h+=String.fromCharCode(d[f])}i.push(h),o=u(o,p)}var y=i.length;i.forEach(function(t,o){r(n.decodePacket(t,e,!0),o,y)})}}).call(this,"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{"./keys":26,after:27,"arraybuffer.slice":28,"base64-arraybuffer":29,blob:30,"has-binary":36,utf8:31}],26:[function(t,e,n){e.exports=Object.keys||function(t){var e=[],n=Object.prototype.hasOwnProperty;for(var r in t)n.call(t,r)&&e.push(r);return e}},{}],27:[function(t,e,n){function r(t,e,n){function r(t,o){if(r.count<=0)throw new Error("after called too many times");--r.count,t?(i=!0,e(t),e=n):0!==r.count||i||e(null,o)}var i=!1;return n=n||o,r.count=t,0===t?e():r}function o(){}e.exports=r},{}],28:[function(t,e,n){e.exports=function(t,e,n){var r=t.byteLength;if(e=e||0,n=n||r,t.slice)return t.slice(e,n);if(0>e&&(e+=r),0>n&&(n+=r),n>r&&(n=r),e>=r||e>=n||0===r)return new ArrayBuffer(0);for(var o=new Uint8Array(t),i=new Uint8Array(n-e),s=e,a=0;n>s;s++,a++)i[a]=o[s];return i.buffer}},{}],29:[function(t,e,n){!function(t){"use strict";n.encode=function(e){var n,r=new Uint8Array(e),o=r.length,i="";for(n=0;o>n;n+=3)i+=t[r[n]>>2],i+=t[(3&r[n])<<4|r[n+1]>>4],i+=t[(15&r[n+1])<<2|r[n+2]>>6],i+=t[63&r[n+2]];return o%3===2?i=i.substring(0,i.length-1)+"=":o%3===1&&(i=i.substring(0,i.length-2)+"=="),i},n.decode=function(e){var n,r,o,i,s,a=.75*e.length,c=e.length,p=0;"="===e[e.length-1]&&(a--,"="===e[e.length-2]&&a--);var u=new ArrayBuffer(a),f=new Uint8Array(u);for(n=0;c>n;n+=4)r=t.indexOf(e[n]),o=t.indexOf(e[n+1]),i=t.indexOf(e[n+2]),s=t.indexOf(e[n+3]),f[p++]=r<<2|o>>4,f[p++]=(15&o)<<4|i>>2,f[p++]=(3&i)<<6|63&s;return u}}("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")},{}],30:[function(t,e,n){(function(t){function n(t){for(var e=0;e<t.length;e++){var n=t[e];if(n.buffer instanceof ArrayBuffer){var r=n.buffer;if(n.byteLength!==r.byteLength){var o=new Uint8Array(n.byteLength);o.set(new Uint8Array(r,n.byteOffset,n.byteLength)),r=o.buffer}t[e]=r}}}function r(t,e){e=e||{};var r=new i;n(t);for(var o=0;o<t.length;o++)r.append(t[o]);return e.type?r.getBlob(e.type):r.getBlob()}function o(t,e){return n(t),new Blob(t,e||{})}var i=t.BlobBuilder||t.WebKitBlobBuilder||t.MSBlobBuilder||t.MozBlobBuilder,s=function(){try{var t=new Blob(["hi"]);return 2===t.size}catch(e){return!1}}(),a=s&&function(){try{var t=new Blob([new Uint8Array([1,2])]);return 2===t.size}catch(e){return!1}}(),c=i&&i.prototype.append&&i.prototype.getBlob;e.exports=function(){return s?a?t.Blob:o:c?r:void 0}()}).call(this,"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}],31:[function(e,n,r){(function(e){!function(o){function i(t){for(var e,n,r=[],o=0,i=t.length;i>o;)e=t.charCodeAt(o++),e>=55296&&56319>=e&&i>o?(n=t.charCodeAt(o++),56320==(64512&n)?r.push(((1023&e)<<10)+(1023&n)+65536):(r.push(e),o--)):r.push(e);return r}function s(t){for(var e,n=t.length,r=-1,o="";++r<n;)e=t[r],e>65535&&(e-=65536,o+=w(e>>>10&1023|55296),e=56320|1023&e),o+=w(e);return o}function a(t){if(t>=55296&&57343>=t)throw Error("Lone surrogate U+"+t.toString(16).toUpperCase()+" is not a scalar value")}function c(t,e){return w(t>>e&63|128)}function p(t){if(0==(4294967168&t))return w(t);var e="";return 0==(4294965248&t)?e=w(t>>6&31|192):0==(4294901760&t)?(a(t),e=w(t>>12&15|224),e+=c(t,6)):0==(4292870144&t)&&(e=w(t>>18&7|240),e+=c(t,12),e+=c(t,6)),e+=w(63&t|128)}function u(t){for(var e,n=i(t),r=n.length,o=-1,s="";++o<r;)e=n[o],s+=p(e);return s}function f(){if(b>=v)throw Error("Invalid byte index");var t=255&m[b];if(b++,128==(192&t))return 63&t;throw Error("Invalid continuation byte")}function h(){var t,e,n,r,o;if(b>v)throw Error("Invalid byte index");if(b==v)return!1;if(t=255&m[b],b++,0==(128&t))return t;if(192==(224&t)){var e=f();if(o=(31&t)<<6|e,o>=128)return o;throw Error("Invalid continuation byte")}if(224==(240&t)){if(e=f(),n=f(),o=(15&t)<<12|e<<6|n,o>=2048)return a(o),o;throw Error("Invalid continuation byte")}if(240==(248&t)&&(e=f(),n=f(),r=f(),o=(15&t)<<18|e<<12|n<<6|r,o>=65536&&1114111>=o))return o;throw Error("Invalid UTF-8 detected")}function l(t){m=i(t),v=m.length,b=0;for(var e,n=[];(e=h())!==!1;)n.push(e);return s(n)}var d="object"==typeof r&&r,y="object"==typeof n&&n&&n.exports==d&&n,g="object"==typeof e&&e;(g.global===g||g.window===g)&&(o=g);var m,v,b,w=String.fromCharCode,k={version:"2.0.0",encode:u,decode:l};if("function"==typeof t&&"object"==typeof t.amd&&t.amd)t(function(){return k});else if(d&&!d.nodeType)if(y)y.exports=k;else{var x={},A=x.hasOwnProperty;for(var B in k)A.call(k,B)&&(d[B]=k[B])}else o.utf8=k}(this)}).call(this,"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}],32:[function(t,e,n){(function(t){var n=/^[\],:{}\s]*$/,r=/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g,o=/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,i=/(?:^|:|,)(?:\s*\[)+/g,s=/^\s+/,a=/\s+$/;e.exports=function(e){return"string"==typeof e&&e?(e=e.replace(s,"").replace(a,""),t.JSON&&JSON.parse?JSON.parse(e):n.test(e.replace(r,"@").replace(o,"]").replace(i,""))?new Function("return "+e)():void 0):null}}).call(this,"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}],33:[function(t,e,n){n.encode=function(t){var e="";for(var n in t)t.hasOwnProperty(n)&&(e.length&&(e+="&"),e+=encodeURIComponent(n)+"="+encodeURIComponent(t[n]));return e},n.decode=function(t){for(var e={},n=t.split("&"),r=0,o=n.length;o>r;r++){var i=n[r].split("=");e[decodeURIComponent(i[0])]=decodeURIComponent(i[1])}return e}},{}],34:[function(t,e,n){var r=/^(?:(?![^:@]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/,o=["source","protocol","authority","userInfo","user","password","host","port","relative","path","directory","file","query","anchor"];e.exports=function(t){var e=t,n=t.indexOf("["),i=t.indexOf("]");-1!=n&&-1!=i&&(t=t.substring(0,n)+t.substring(n,i).replace(/:/g,";")+t.substring(i,t.length));for(var s=r.exec(t||""),a={},c=14;c--;)a[o[c]]=s[c]||"";return-1!=n&&-1!=i&&(a.source=e,a.host=a.host.substring(1,a.host.length-1).replace(/;/g,":"),a.authority=a.authority.replace("[","").replace("]","").replace(/;/g,":"),a.ipv6uri=!0),a}},{}],35:[function(t,e,n){function r(t,e,n){var r;return r=e?new i(t,e):new i(t)}var o=function(){return this}(),i=o.WebSocket||o.MozWebSocket;e.exports=i?r:null,i&&(r.prototype=i.prototype)},{}],36:[function(t,e,n){(function(n){function r(t){function e(t){if(!t)return!1;if(n.Buffer&&n.Buffer.isBuffer(t)||n.ArrayBuffer&&t instanceof ArrayBuffer||n.Blob&&t instanceof Blob||n.File&&t instanceof File)return!0;if(o(t)){for(var r=0;r<t.length;r++)if(e(t[r]))return!0}else if(t&&"object"==typeof t){t.toJSON&&(t=t.toJSON());for(var i in t)if(Object.prototype.hasOwnProperty.call(t,i)&&e(t[i]))return!0}return!1}return e(t)}var o=t("isarray");e.exports=r}).call(this,"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{isarray:37}],37:[function(t,e,n){e.exports=Array.isArray||function(t){return"[object Array]"==Object.prototype.toString.call(t)}},{}],38:[function(t,e,n){var r=t("global");try{e.exports="XMLHttpRequest"in r&&"withCredentials"in new r.XMLHttpRequest}catch(o){e.exports=!1}},{global:39}],39:[function(t,e,n){e.exports=function(){return this}()},{}],40:[function(t,e,n){var r=[].indexOf;e.exports=function(t,e){if(r)return t.indexOf(e);for(var n=0;n<t.length;++n)if(t[n]===e)return n;return-1}},{}],41:[function(t,e,n){var r=Object.prototype.hasOwnProperty;n.keys=Object.keys||function(t){var e=[];for(var n in t)r.call(t,n)&&e.push(n);return e},n.values=function(t){var e=[];for(var n in t)r.call(t,n)&&e.push(t[n]);return e},n.merge=function(t,e){for(var n in e)r.call(e,n)&&(t[n]=e[n]);return t},n.length=function(t){return n.keys(t).length},n.isEmpty=function(t){return 0==n.length(t)}},{}],42:[function(t,e,n){var r=/^(?:(?![^:@]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/,o=["source","protocol","authority","userInfo","user","password","host","port","relative","path","directory","file","query","anchor"];e.exports=function(t){for(var e=r.exec(t||""),n={},i=14;i--;)n[o[i]]=e[i]||"";return n}},{}],43:[function(t,e,n){(function(e){var r=t("isarray"),o=t("./is-buffer");n.deconstructPacket=function(t){function e(t){if(!t)return t;if(o(t)){var i={_placeholder:!0,num:n.length};return n.push(t),i}if(r(t)){for(var s=new Array(t.length),a=0;a<t.length;a++)s[a]=e(t[a]);return s}if("object"==typeof t&&!(t instanceof Date)){var s={};for(var c in t)s[c]=e(t[c]);return s}return t}var n=[],i=t.data,s=t;return s.data=e(i),s.attachments=n.length,{packet:s,buffers:n}},n.reconstructPacket=function(t,e){function n(t){if(t&&t._placeholder){var o=e[t.num];return o}if(r(t)){for(var i=0;i<t.length;i++)t[i]=n(t[i]);return t}if(t&&"object"==typeof t){for(var s in t)t[s]=n(t[s]);return t}return t}return t.data=n(t.data),t.attachments=void 0,t},n.removeBlobs=function(t,n){function i(t,c,p){if(!t)return t;if(e.Blob&&t instanceof Blob||e.File&&t instanceof File){s++;var u=new FileReader;u.onload=function(){p?p[c]=this.result:a=this.result,--s||n(a)},u.readAsArrayBuffer(t)}else if(r(t))for(var f=0;f<t.length;f++)i(t[f],f,t);else if(t&&"object"==typeof t&&!o(t))for(var h in t)i(t[h],h,t)}var s=0,a=t;i(a),s||n(a)}}).call(this,"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{"./is-buffer":45,isarray:46}],44:[function(t,e,n){function r(){}function o(t){var e="",r=!1;return e+=t.type,(n.BINARY_EVENT==t.type||n.BINARY_ACK==t.type)&&(e+=t.attachments,e+="-"),t.nsp&&"/"!=t.nsp&&(r=!0,e+=t.nsp),null!=t.id&&(r&&(e+=",",r=!1),e+=t.id),null!=t.data&&(r&&(e+=","),e+=f.stringify(t.data)),u("encoded %j as %s",t,e),e}function i(t,e){function n(t){var n=l.deconstructPacket(t),r=o(n.packet),i=n.buffers;i.unshift(r),e(i)}l.removeBlobs(t,n)}function s(){this.reconstructor=null}function a(t){var e={},r=0;if(e.type=Number(t.charAt(0)),null==n.types[e.type])return p();if(n.BINARY_EVENT==e.type||n.BINARY_ACK==e.type){for(var o="";"-"!=t.charAt(++r)&&(o+=t.charAt(r),r!=t.length););if(o!=Number(o)||"-"!=t.charAt(r))throw new Error("Illegal attachments");e.attachments=Number(o)}if("/"==t.charAt(r+1))for(e.nsp="";++r;){var i=t.charAt(r);if(","==i)break;if(e.nsp+=i,r==t.length)break}else e.nsp="/";var s=t.charAt(r+1);if(""!==s&&Number(s)==s){for(e.id="";++r;){var i=t.charAt(r);if(null==i||Number(i)!=i){--r;break}if(e.id+=t.charAt(r),r==t.length)break}e.id=Number(e.id)}if(t.charAt(++r))try{e.data=f.parse(t.substr(r))}catch(a){return p()}return u("decoded %s as %j",t,e),e}function c(t){this.reconPack=t,this.buffers=[]}function p(t){return{type:n.ERROR,data:"parser error"}}var u=t("debug")("socket.io-parser"),f=t("json3"),h=(t("isarray"),t("component-emitter")),l=t("./binary"),d=t("./is-buffer");n.protocol=4,n.types=["CONNECT","DISCONNECT","EVENT","BINARY_EVENT","ACK","BINARY_ACK","ERROR"],n.CONNECT=0,n.DISCONNECT=1,n.EVENT=2,n.ACK=3,n.ERROR=4,n.BINARY_EVENT=5,n.BINARY_ACK=6,n.Encoder=r,n.Decoder=s,r.prototype.encode=function(t,e){if(u("encoding packet %j",t),n.BINARY_EVENT==t.type||n.BINARY_ACK==t.type)i(t,e);else{var r=o(t);e([r])}},h(s.prototype),s.prototype.add=function(t){var e;if("string"==typeof t)e=a(t),n.BINARY_EVENT==e.type||n.BINARY_ACK==e.type?(this.reconstructor=new c(e),0===this.reconstructor.reconPack.attachments&&this.emit("decoded",e)):this.emit("decoded",e);else{if(!d(t)&&!t.base64)throw new Error("Unknown type: "+t);if(!this.reconstructor)throw new Error("got binary data when not reconstructing a packet");e=this.reconstructor.takeBinaryData(t),e&&(this.reconstructor=null,this.emit("decoded",e))}},s.prototype.destroy=function(){this.reconstructor&&this.reconstructor.finishedReconstruction()},c.prototype.takeBinaryData=function(t){if(this.buffers.push(t),this.buffers.length==this.reconPack.attachments){var e=l.reconstructPacket(this.reconPack,this.buffers);return this.finishedReconstruction(),e}return null},c.prototype.finishedReconstruction=function(){this.reconPack=null,this.buffers=[]}},{"./binary":43,"./is-buffer":45,"component-emitter":9,debug:10,isarray:46,json3:47}],45:[function(t,e,n){(function(t){function n(e){return t.Buffer&&t.Buffer.isBuffer(e)||t.ArrayBuffer&&e instanceof ArrayBuffer}e.exports=n}).call(this,"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}],46:[function(t,e,n){e.exports=t(37)},{}],47:[function(e,n,r){!function(e){function n(t){if(n[t]!==s)return n[t];var e;if("bug-string-char-index"==t)e="a"!="a"[0];else if("json"==t)e=n("json-stringify")&&n("json-parse");else{var r,o='{"a":[1,true,false,null,"\\u0000\\b\\n\\f\\r\\t"]}';if("json-stringify"==t){var i=u.stringify,c="function"==typeof i&&f;if(c){(r=function(){return 1}).toJSON=r;try{c="0"===i(0)&&"0"===i(new Number)&&'""'==i(new String)&&i(a)===s&&i(s)===s&&i()===s&&"1"===i(r)&&"[1]"==i([r])&&"[null]"==i([s])&&"null"==i(null)&&"[null,null,null]"==i([s,a,null])&&i({a:[r,!0,!1,null,"\x00\b\n\f\r	"]})==o&&"1"===i(null,r)&&"[\n 1,\n 2\n]"==i([1,2],null,1)&&'"-271821-04-20T00:00:00.000Z"'==i(new Date(-864e13))&&'"+275760-09-13T00:00:00.000Z"'==i(new Date(864e13))&&'"-000001-01-01T00:00:00.000Z"'==i(new Date(-621987552e5))&&'"1969-12-31T23:59:59.999Z"'==i(new Date(-1))}catch(p){c=!1}}e=c}if("json-parse"==t){var h=u.parse;if("function"==typeof h)try{if(0===h("0")&&!h(!1)){r=h(o);var l=5==r.a.length&&1===r.a[0];if(l){try{l=!h('"	"')}catch(p){}if(l)try{l=1!==h("01")}catch(p){}if(l)try{l=1!==h("1.")}catch(p){}}}}catch(p){l=!1}e=l}}return n[t]=!!e}var o,i,s,a={}.toString,c="function"==typeof t&&t.amd,p="object"==typeof JSON&&JSON,u="object"==typeof r&&r&&!r.nodeType&&r;u&&p?(u.stringify=p.stringify,u.parse=p.parse):u=e.JSON=p||{};var f=new Date(-0xc782b5b800cec);try{f=-109252==f.getUTCFullYear()&&0===f.getUTCMonth()&&1===f.getUTCDate()&&10==f.getUTCHours()&&37==f.getUTCMinutes()&&6==f.getUTCSeconds()&&708==f.getUTCMilliseconds()}catch(h){}if(!n("json")){var l="[object Function]",d="[object Date]",y="[object Number]",g="[object String]",m="[object Array]",v="[object Boolean]",b=n("bug-string-char-index");if(!f)var w=Math.floor,k=[0,31,59,90,120,151,181,212,243,273,304,334],x=function(t,e){return k[e]+365*(t-1970)+w((t-1969+(e=+(e>1)))/4)-w((t-1901+e)/100)+w((t-1601+e)/400)};(o={}.hasOwnProperty)||(o=function(t){var e,n={};return(n.__proto__=null,n.__proto__={toString:1},n).toString!=a?o=function(t){var e=this.__proto__,n=t in(this.__proto__=null,this);return this.__proto__=e,n}:(e=n.constructor,o=function(t){var n=(this.constructor||e).prototype;return t in this&&!(t in n&&this[t]===n[t])}),n=null,o.call(this,t)});var A={"boolean":1,number:1,string:1,undefined:1},B=function(t,e){var n=typeof t[e];return"object"==n?!!t[e]:!A[n]};if(i=function(t,e){var n,r,s,c=0;(n=function(){this.valueOf=0}).prototype.valueOf=0,r=new n;for(s in r)o.call(r,s)&&c++;return n=r=null,c?i=2==c?function(t,e){var n,r={},i=a.call(t)==l;for(n in t)i&&"prototype"==n||o.call(r,n)||!(r[n]=1)||!o.call(t,n)||e(n)}:function(t,e){var n,r,i=a.call(t)==l;for(n in t)i&&"prototype"==n||!o.call(t,n)||(r="constructor"===n)||e(n);(r||o.call(t,n="constructor"))&&e(n)}:(r=["valueOf","toString","toLocaleString","propertyIsEnumerable","isPrototypeOf","hasOwnProperty","constructor"],i=function(t,e){var n,i,s=a.call(t)==l,c=!s&&"function"!=typeof t.constructor&&B(t,"hasOwnProperty")?t.hasOwnProperty:o;for(n in t)s&&"prototype"==n||!c.call(t,n)||e(n);for(i=r.length;n=r[--i];c.call(t,n)&&e(n));}),i(t,e)},!n("json-stringify")){var C={92:"\\\\",34:'\\"',8:"\\b",12:"\\f",10:"\\n",13:"\\r",9:"\\t"},S="000000",E=function(t,e){return(S+(e||0)).slice(-t)},T="\\u00",j=function(t){var e,n='"',r=0,o=t.length,i=o>10&&b;for(i&&(e=t.split(""));o>r;r++){var s=t.charCodeAt(r);switch(s){case 8:case 9:case 10:case 12:case 13:case 34:case 92:n+=C[s];break;default:if(32>s){n+=T+E(2,s.toString(16));break}n+=i?e[r]:b?t.charAt(r):t[r]}}return n+'"'},_=function(t,e,n,r,c,p,u){var f,h,l,b,k,A,B,C,S,T,P,R,N,O,U,q;try{f=e[t]}catch(D){}if("object"==typeof f&&f)if(h=a.call(f),h!=d||o.call(f,"toJSON"))"function"==typeof f.toJSON&&(h!=y&&h!=g&&h!=m||o.call(f,"toJSON"))&&(f=f.toJSON(t));else if(f>-1/0&&1/0>f){if(x){for(k=w(f/864e5),l=w(k/365.2425)+1970-1;x(l+1,0)<=k;l++);for(b=w((k-x(l,0))/30.42);x(l,b+1)<=k;b++);k=1+k-x(l,b),A=(f%864e5+864e5)%864e5,B=w(A/36e5)%24,C=w(A/6e4)%60,S=w(A/1e3)%60,T=A%1e3}else l=f.getUTCFullYear(),b=f.getUTCMonth(),k=f.getUTCDate(),B=f.getUTCHours(),C=f.getUTCMinutes(),S=f.getUTCSeconds(),T=f.getUTCMilliseconds();f=(0>=l||l>=1e4?(0>l?"-":"+")+E(6,0>l?-l:l):E(4,l))+"-"+E(2,b+1)+"-"+E(2,k)+"T"+E(2,B)+":"+E(2,C)+":"+E(2,S)+"."+E(3,T)+"Z"}else f=null;if(n&&(f=n.call(e,t,f)),null===f)return"null";if(h=a.call(f),h==v)return""+f;if(h==y)return f>-1/0&&1/0>f?""+f:"null";if(h==g)return j(""+f);if("object"==typeof f){for(O=u.length;O--;)if(u[O]===f)throw TypeError();if(u.push(f),P=[],U=p,p+=c,h==m){for(N=0,O=f.length;O>N;N++)R=_(N,f,n,r,c,p,u),P.push(R===s?"null":R);q=P.length?c?"[\n"+p+P.join(",\n"+p)+"\n"+U+"]":"["+P.join(",")+"]":"[]"}else i(r||f,function(t){var e=_(t,f,n,r,c,p,u);e!==s&&P.push(j(t)+":"+(c?" ":"")+e)}),q=P.length?c?"{\n"+p+P.join(",\n"+p)+"\n"+U+"}":"{"+P.join(",")+"}":"{}";return u.pop(),q}};u.stringify=function(t,e,n){var r,o,i,s;if("function"==typeof e||"object"==typeof e&&e)if((s=a.call(e))==l)o=e;else if(s==m){i={};for(var c,p=0,u=e.length;u>p;c=e[p++],s=a.call(c),(s==g||s==y)&&(i[c]=1));}if(n)if((s=a.call(n))==y){if((n-=n%1)>0)for(r="",n>10&&(n=10);r.length<n;r+=" ");}else s==g&&(r=n.length<=10?n:n.slice(0,10));return _("",(c={},c[""]=t,c),o,i,r,"",[])}}if(!n("json-parse")){var P,R,N=String.fromCharCode,O={92:"\\",34:'"',47:"/",98:"\b",116:"	",110:"\n",102:"\f",114:"\r"},U=function(){throw P=R=null,SyntaxError()},q=function(){for(var t,e,n,r,o,i=R,s=i.length;s>P;)switch(o=i.charCodeAt(P)){case 9:case 10:case 13:case 32:P++;break;case 123:case 125:case 91:case 93:case 58:case 44:return t=b?i.charAt(P):i[P],P++,t;case 34:for(t="@",P++;s>P;)if(o=i.charCodeAt(P),32>o)U();else if(92==o)switch(o=i.charCodeAt(++P)){case 92:case 34:case 47:case 98:case 116:case 110:case 102:case 114:t+=O[o],P++;break;case 117:for(e=++P,n=P+4;n>P;P++)o=i.charCodeAt(P),o>=48&&57>=o||o>=97&&102>=o||o>=65&&70>=o||U();t+=N("0x"+i.slice(e,P));break;default:U()}else{if(34==o)break;for(o=i.charCodeAt(P),e=P;o>=32&&92!=o&&34!=o;)o=i.charCodeAt(++P);t+=i.slice(e,P)}if(34==i.charCodeAt(P))return P++,t;U();default:if(e=P,45==o&&(r=!0,o=i.charCodeAt(++P)),o>=48&&57>=o){for(48==o&&(o=i.charCodeAt(P+1),o>=48&&57>=o)&&U(),r=!1;s>P&&(o=i.charCodeAt(P),o>=48&&57>=o);P++);if(46==i.charCodeAt(P)){for(n=++P;s>n&&(o=i.charCodeAt(n),o>=48&&57>=o);n++);n==P&&U(),P=n}if(o=i.charCodeAt(P),101==o||69==o){for(o=i.charCodeAt(++P),(43==o||45==o)&&P++,n=P;s>n&&(o=i.charCodeAt(n),o>=48&&57>=o);n++);
n==P&&U(),P=n}return+i.slice(e,P)}if(r&&U(),"true"==i.slice(P,P+4))return P+=4,!0;if("false"==i.slice(P,P+5))return P+=5,!1;if("null"==i.slice(P,P+4))return P+=4,null;U()}return"$"},D=function(t){var e,n;if("$"==t&&U(),"string"==typeof t){if("@"==(b?t.charAt(0):t[0]))return t.slice(1);if("["==t){for(e=[];t=q(),"]"!=t;n||(n=!0))n&&(","==t?(t=q(),"]"==t&&U()):U()),","==t&&U(),e.push(D(t));return e}if("{"==t){for(e={};t=q(),"}"!=t;n||(n=!0))n&&(","==t?(t=q(),"}"==t&&U()):U()),(","==t||"string"!=typeof t||"@"!=(b?t.charAt(0):t[0])||":"!=q())&&U(),e[t.slice(1)]=D(q());return e}U()}return t},I=function(t,e,n){var r=L(t,e,n);r===s?delete t[e]:t[e]=r},L=function(t,e,n){var r,o=t[e];if("object"==typeof o&&o)if(a.call(o)==m)for(r=o.length;r--;)I(o,r,n);else i(o,function(t){I(o,t,n)});return n.call(t,e,o)};u.parse=function(t,e){var n,r;return P=0,R=""+t,n=D(q()),"$"!=q()&&U(),P=R=null,e&&a.call(e)==l?L((r={},r[""]=n,r),"",e):n}}}c&&t(function(){return u})}(this)},{}],48:[function(t,e,n){function r(t,e){var n=[];e=e||0;for(var r=e||0;r<t.length;r++)n[r-e]=t[r];return n}e.exports=r},{}]},{},[1])(1)});

/****	SHA1 library code *******/

function SHA1(s){function U(a,b,c){while(0<c--)a.push(b)}function L(a,b){return(a<<b)|(a>>>(32-b))}function P(a,b,c){return a^b^c}function A(a,b){var c=(b&0xFFFF)+(a&0xFFFF),d=(b>>>16)+(a>>>16)+(c>>>16);return((d&0xFFFF)<<16)|(c&0xFFFF)}var B="0123456789abcdef";return(function(a){var c=[],d=a.length*4,e;for(var i=0;i<d;i++){e=a[i>>2]>>((3-(i%4))*8);c.push(B.charAt((e>>4)&0xF)+B.charAt(e&0xF))}return c.join('')}((function(a,b){var c,d,e,f,g,h=a.length,v=0x67452301,w=0xefcdab89,x=0x98badcfe,y=0x10325476,z=0xc3d2e1f0,M=[];U(M,0x5a827999,20);U(M,0x6ed9eba1,20);U(M,0x8f1bbcdc,20);U(M,0xca62c1d6,20);a[b>>5]|=0x80<<(24-(b%32));a[(((b+65)>>9)<<4)+15]=b;for(var i=0;i<h;i+=16){c=v;d=w;e=x;f=y;g=z;for(var j=0,O=[];j<80;j++){O[j]=j<16?a[j+i]:L(O[j-3]^O[j-8]^O[j-14]^O[j-16],1);var k=(function(a,b,c,d,e){var f=(e&0xFFFF)+(a&0xFFFF)+(b&0xFFFF)+(c&0xFFFF)+(d&0xFFFF),g=(e>>>16)+(a>>>16)+(b>>>16)+(c>>>16)+(d>>>16)+(f>>>16);return((g&0xFFFF)<<16)|(f&0xFFFF)})(j<20?(function(t,a,b){return(t&a)^(~t&b)}(d,e,f)):j<40?P(d,e,f):j<60?(function(t,a,b){return(t&a)^(t&b)^(a&b)}(d,e,f)):P(d,e,f),g,M[j],O[j],L(c,5));g=f;f=e;e=L(d,30);d=c;c=k}v=A(v,c);w=A(w,d);x=A(x,e);y=A(y,f);z=A(z,g)}return[v,w,x,y,z]}((function(t){var a=[],b=255,c=t.length*8;for(var i=0;i<c;i+=8){a[i>>5]|=(t.charCodeAt(i/8)&b)<<(24-(i%32))}return a}(s)).slice(),s.length*8))))}

/****	MD5 library code *******/

!function(a){"use strict";function b(a,b){var c=(65535&a)+(65535&b),d=(a>>16)+(b>>16)+(c>>16);return d<<16|65535&c}function c(a,b){return a<<b|a>>>32-b}function d(a,d,e,f,g,h){return b(c(b(b(d,a),b(f,h)),g),e)}function e(a,b,c,e,f,g,h){return d(b&c|~b&e,a,b,f,g,h)}function f(a,b,c,e,f,g,h){return d(b&e|c&~e,a,b,f,g,h)}function g(a,b,c,e,f,g,h){return d(b^c^e,a,b,f,g,h)}function h(a,b,c,e,f,g,h){return d(c^(b|~e),a,b,f,g,h)}function i(a,c){a[c>>5]|=128<<c%32,a[(c+64>>>9<<4)+14]=c;var d,i,j,k,l,m=1732584193,n=-271733879,o=-1732584194,p=271733878;for(d=0;d<a.length;d+=16)i=m,j=n,k=o,l=p,m=e(m,n,o,p,a[d],7,-680876936),p=e(p,m,n,o,a[d+1],12,-389564586),o=e(o,p,m,n,a[d+2],17,606105819),n=e(n,o,p,m,a[d+3],22,-1044525330),m=e(m,n,o,p,a[d+4],7,-176418897),p=e(p,m,n,o,a[d+5],12,1200080426),o=e(o,p,m,n,a[d+6],17,-1473231341),n=e(n,o,p,m,a[d+7],22,-45705983),m=e(m,n,o,p,a[d+8],7,1770035416),p=e(p,m,n,o,a[d+9],12,-1958414417),o=e(o,p,m,n,a[d+10],17,-42063),n=e(n,o,p,m,a[d+11],22,-1990404162),m=e(m,n,o,p,a[d+12],7,1804603682),p=e(p,m,n,o,a[d+13],12,-40341101),o=e(o,p,m,n,a[d+14],17,-1502002290),n=e(n,o,p,m,a[d+15],22,1236535329),m=f(m,n,o,p,a[d+1],5,-165796510),p=f(p,m,n,o,a[d+6],9,-1069501632),o=f(o,p,m,n,a[d+11],14,643717713),n=f(n,o,p,m,a[d],20,-373897302),m=f(m,n,o,p,a[d+5],5,-701558691),p=f(p,m,n,o,a[d+10],9,38016083),o=f(o,p,m,n,a[d+15],14,-660478335),n=f(n,o,p,m,a[d+4],20,-405537848),m=f(m,n,o,p,a[d+9],5,568446438),p=f(p,m,n,o,a[d+14],9,-1019803690),o=f(o,p,m,n,a[d+3],14,-187363961),n=f(n,o,p,m,a[d+8],20,1163531501),m=f(m,n,o,p,a[d+13],5,-1444681467),p=f(p,m,n,o,a[d+2],9,-51403784),o=f(o,p,m,n,a[d+7],14,1735328473),n=f(n,o,p,m,a[d+12],20,-1926607734),m=g(m,n,o,p,a[d+5],4,-378558),p=g(p,m,n,o,a[d+8],11,-2022574463),o=g(o,p,m,n,a[d+11],16,1839030562),n=g(n,o,p,m,a[d+14],23,-35309556),m=g(m,n,o,p,a[d+1],4,-1530992060),p=g(p,m,n,o,a[d+4],11,1272893353),o=g(o,p,m,n,a[d+7],16,-155497632),n=g(n,o,p,m,a[d+10],23,-1094730640),m=g(m,n,o,p,a[d+13],4,681279174),p=g(p,m,n,o,a[d],11,-358537222),o=g(o,p,m,n,a[d+3],16,-722521979),n=g(n,o,p,m,a[d+6],23,76029189),m=g(m,n,o,p,a[d+9],4,-640364487),p=g(p,m,n,o,a[d+12],11,-421815835),o=g(o,p,m,n,a[d+15],16,530742520),n=g(n,o,p,m,a[d+2],23,-995338651),m=h(m,n,o,p,a[d],6,-198630844),p=h(p,m,n,o,a[d+7],10,1126891415),o=h(o,p,m,n,a[d+14],15,-1416354905),n=h(n,o,p,m,a[d+5],21,-57434055),m=h(m,n,o,p,a[d+12],6,1700485571),p=h(p,m,n,o,a[d+3],10,-1894986606),o=h(o,p,m,n,a[d+10],15,-1051523),n=h(n,o,p,m,a[d+1],21,-2054922799),m=h(m,n,o,p,a[d+8],6,1873313359),p=h(p,m,n,o,a[d+15],10,-30611744),o=h(o,p,m,n,a[d+6],15,-1560198380),n=h(n,o,p,m,a[d+13],21,1309151649),m=h(m,n,o,p,a[d+4],6,-145523070),p=h(p,m,n,o,a[d+11],10,-1120210379),o=h(o,p,m,n,a[d+2],15,718787259),n=h(n,o,p,m,a[d+9],21,-343485551),m=b(m,i),n=b(n,j),o=b(o,k),p=b(p,l);return[m,n,o,p]}function j(a){var b,c="";for(b=0;b<32*a.length;b+=8)c+=String.fromCharCode(a[b>>5]>>>b%32&255);return c}function k(a){var b,c=[];for(c[(a.length>>2)-1]=void 0,b=0;b<c.length;b+=1)c[b]=0;for(b=0;b<8*a.length;b+=8)c[b>>5]|=(255&a.charCodeAt(b/8))<<b%32;return c}function l(a){return j(i(k(a),8*a.length))}function m(a,b){var c,d,e=k(a),f=[],g=[];for(f[15]=g[15]=void 0,e.length>16&&(e=i(e,8*a.length)),c=0;16>c;c+=1)f[c]=909522486^e[c],g[c]=1549556828^e[c];return d=i(f.concat(k(b)),512+8*b.length),j(i(g.concat(d),640))}function n(a){var b,c,d="0123456789abcdef",e="";for(c=0;c<a.length;c+=1)b=a.charCodeAt(c),e+=d.charAt(b>>>4&15)+d.charAt(15&b);return e}function o(a){return unescape(encodeURIComponent(a))}function p(a){return l(o(a))}function q(a){return n(p(a))}function r(a,b){return m(o(a),o(b))}function s(a,b){return n(r(a,b))}function t(a,b,c){return b?c?r(b,a):s(b,a):c?p(a):q(a)}"function"==typeof define&&define.amd?define(function(){return t}):a.md5=t}(this);

/****	Promises PolyFill library code *******/

(function(){"use strict";function lib$es6$promise$utils$$objectOrFunction(x){return typeof x==="function"||typeof x==="object"&&x!==null}function lib$es6$promise$utils$$isFunction(x){return typeof x==="function"}function lib$es6$promise$utils$$isMaybeThenable(x){return typeof x==="object"&&x!==null}var lib$es6$promise$utils$$_isArray;if(!Array.isArray){lib$es6$promise$utils$$_isArray=function(x){return Object.prototype.toString.call(x)==="[object Array]"}}else{lib$es6$promise$utils$$_isArray=Array.isArray}var lib$es6$promise$utils$$isArray=lib$es6$promise$utils$$_isArray;var lib$es6$promise$asap$$len=0;var lib$es6$promise$asap$$toString={}.toString;var lib$es6$promise$asap$$vertxNext;var lib$es6$promise$asap$$customSchedulerFn;var lib$es6$promise$asap$$asap=function asap(callback,arg){lib$es6$promise$asap$$queue[lib$es6$promise$asap$$len]=callback;lib$es6$promise$asap$$queue[lib$es6$promise$asap$$len+1]=arg;lib$es6$promise$asap$$len+=2;if(lib$es6$promise$asap$$len===2){if(lib$es6$promise$asap$$customSchedulerFn){lib$es6$promise$asap$$customSchedulerFn(lib$es6$promise$asap$$flush)}else{lib$es6$promise$asap$$scheduleFlush()}}};function lib$es6$promise$asap$$setScheduler(scheduleFn){lib$es6$promise$asap$$customSchedulerFn=scheduleFn}function lib$es6$promise$asap$$setAsap(asapFn){lib$es6$promise$asap$$asap=asapFn}var lib$es6$promise$asap$$browserWindow=typeof window!=="undefined"?window:undefined;var lib$es6$promise$asap$$browserGlobal=lib$es6$promise$asap$$browserWindow||{};var lib$es6$promise$asap$$BrowserMutationObserver=lib$es6$promise$asap$$browserGlobal.MutationObserver||lib$es6$promise$asap$$browserGlobal.WebKitMutationObserver;var lib$es6$promise$asap$$isNode=typeof process!=="undefined"&&{}.toString.call(process)==="[object process]";var lib$es6$promise$asap$$isWorker=typeof Uint8ClampedArray!=="undefined"&&typeof importScripts!=="undefined"&&typeof MessageChannel!=="undefined";function lib$es6$promise$asap$$useNextTick(){return function(){process.nextTick(lib$es6$promise$asap$$flush)}}function lib$es6$promise$asap$$useVertxTimer(){return function(){lib$es6$promise$asap$$vertxNext(lib$es6$promise$asap$$flush)}}function lib$es6$promise$asap$$useMutationObserver(){var iterations=0;var observer=new lib$es6$promise$asap$$BrowserMutationObserver(lib$es6$promise$asap$$flush);var node=document.createTextNode("");observer.observe(node,{characterData:true});return function(){node.data=iterations=++iterations%2}}function lib$es6$promise$asap$$useMessageChannel(){var channel=new MessageChannel;channel.port1.onmessage=lib$es6$promise$asap$$flush;return function(){channel.port2.postMessage(0)}}function lib$es6$promise$asap$$useSetTimeout(){return function(){setTimeout(lib$es6$promise$asap$$flush,1)}}var lib$es6$promise$asap$$queue=new Array(1e3);function lib$es6$promise$asap$$flush(){for(var i=0;i<lib$es6$promise$asap$$len;i+=2){var callback=lib$es6$promise$asap$$queue[i];var arg=lib$es6$promise$asap$$queue[i+1];callback(arg);lib$es6$promise$asap$$queue[i]=undefined;lib$es6$promise$asap$$queue[i+1]=undefined}lib$es6$promise$asap$$len=0}function lib$es6$promise$asap$$attemptVertx(){try{var r=require;var vertx=r("vertx");lib$es6$promise$asap$$vertxNext=vertx.runOnLoop||vertx.runOnContext;return lib$es6$promise$asap$$useVertxTimer()}catch(e){return lib$es6$promise$asap$$useSetTimeout()}}var lib$es6$promise$asap$$scheduleFlush;if(lib$es6$promise$asap$$isNode){lib$es6$promise$asap$$scheduleFlush=lib$es6$promise$asap$$useNextTick()}else if(lib$es6$promise$asap$$BrowserMutationObserver){lib$es6$promise$asap$$scheduleFlush=lib$es6$promise$asap$$useMutationObserver()}else if(lib$es6$promise$asap$$isWorker){lib$es6$promise$asap$$scheduleFlush=lib$es6$promise$asap$$useMessageChannel()}else if(lib$es6$promise$asap$$browserWindow===undefined&&typeof require==="function"){lib$es6$promise$asap$$scheduleFlush=lib$es6$promise$asap$$attemptVertx()}else{lib$es6$promise$asap$$scheduleFlush=lib$es6$promise$asap$$useSetTimeout()}function lib$es6$promise$$internal$$noop(){}var lib$es6$promise$$internal$$PENDING=void 0;var lib$es6$promise$$internal$$FULFILLED=1;var lib$es6$promise$$internal$$REJECTED=2;var lib$es6$promise$$internal$$GET_THEN_ERROR=new lib$es6$promise$$internal$$ErrorObject;function lib$es6$promise$$internal$$selfFulfillment(){return new TypeError("You cannot resolve a promise with itself")}function lib$es6$promise$$internal$$cannotReturnOwn(){return new TypeError("A promises callback cannot return that same promise.")}function lib$es6$promise$$internal$$getThen(promise){try{return promise.then}catch(error){lib$es6$promise$$internal$$GET_THEN_ERROR.error=error;return lib$es6$promise$$internal$$GET_THEN_ERROR}}function lib$es6$promise$$internal$$tryThen(then,value,fulfillmentHandler,rejectionHandler){try{then.call(value,fulfillmentHandler,rejectionHandler)}catch(e){return e}}function lib$es6$promise$$internal$$handleForeignThenable(promise,thenable,then){lib$es6$promise$asap$$asap(function(promise){var sealed=false;var error=lib$es6$promise$$internal$$tryThen(then,thenable,function(value){if(sealed){return}sealed=true;if(thenable!==value){lib$es6$promise$$internal$$resolve(promise,value)}else{lib$es6$promise$$internal$$fulfill(promise,value)}},function(reason){if(sealed){return}sealed=true;lib$es6$promise$$internal$$reject(promise,reason)},"Settle: "+(promise._label||" unknown promise"));if(!sealed&&error){sealed=true;lib$es6$promise$$internal$$reject(promise,error)}},promise)}function lib$es6$promise$$internal$$handleOwnThenable(promise,thenable){if(thenable._state===lib$es6$promise$$internal$$FULFILLED){lib$es6$promise$$internal$$fulfill(promise,thenable._result)}else if(thenable._state===lib$es6$promise$$internal$$REJECTED){lib$es6$promise$$internal$$reject(promise,thenable._result)}else{lib$es6$promise$$internal$$subscribe(thenable,undefined,function(value){lib$es6$promise$$internal$$resolve(promise,value)},function(reason){lib$es6$promise$$internal$$reject(promise,reason)})}}function lib$es6$promise$$internal$$handleMaybeThenable(promise,maybeThenable){if(maybeThenable.constructor===promise.constructor){lib$es6$promise$$internal$$handleOwnThenable(promise,maybeThenable)}else{var then=lib$es6$promise$$internal$$getThen(maybeThenable);if(then===lib$es6$promise$$internal$$GET_THEN_ERROR){lib$es6$promise$$internal$$reject(promise,lib$es6$promise$$internal$$GET_THEN_ERROR.error)}else if(then===undefined){lib$es6$promise$$internal$$fulfill(promise,maybeThenable)}else if(lib$es6$promise$utils$$isFunction(then)){lib$es6$promise$$internal$$handleForeignThenable(promise,maybeThenable,then)}else{lib$es6$promise$$internal$$fulfill(promise,maybeThenable)}}}function lib$es6$promise$$internal$$resolve(promise,value){if(promise===value){lib$es6$promise$$internal$$reject(promise,lib$es6$promise$$internal$$selfFulfillment())}else if(lib$es6$promise$utils$$objectOrFunction(value)){lib$es6$promise$$internal$$handleMaybeThenable(promise,value)}else{lib$es6$promise$$internal$$fulfill(promise,value)}}function lib$es6$promise$$internal$$publishRejection(promise){if(promise._onerror){promise._onerror(promise._result)}lib$es6$promise$$internal$$publish(promise)}function lib$es6$promise$$internal$$fulfill(promise,value){if(promise._state!==lib$es6$promise$$internal$$PENDING){return}promise._result=value;promise._state=lib$es6$promise$$internal$$FULFILLED;if(promise._subscribers.length!==0){lib$es6$promise$asap$$asap(lib$es6$promise$$internal$$publish,promise)}}function lib$es6$promise$$internal$$reject(promise,reason){if(promise._state!==lib$es6$promise$$internal$$PENDING){return}promise._state=lib$es6$promise$$internal$$REJECTED;promise._result=reason;lib$es6$promise$asap$$asap(lib$es6$promise$$internal$$publishRejection,promise)}function lib$es6$promise$$internal$$subscribe(parent,child,onFulfillment,onRejection){var subscribers=parent._subscribers;var length=subscribers.length;parent._onerror=null;subscribers[length]=child;subscribers[length+lib$es6$promise$$internal$$FULFILLED]=onFulfillment;subscribers[length+lib$es6$promise$$internal$$REJECTED]=onRejection;if(length===0&&parent._state){lib$es6$promise$asap$$asap(lib$es6$promise$$internal$$publish,parent)}}function lib$es6$promise$$internal$$publish(promise){var subscribers=promise._subscribers;var settled=promise._state;if(subscribers.length===0){return}var child,callback,detail=promise._result;for(var i=0;i<subscribers.length;i+=3){child=subscribers[i];callback=subscribers[i+settled];if(child){lib$es6$promise$$internal$$invokeCallback(settled,child,callback,detail)}else{callback(detail)}}promise._subscribers.length=0}function lib$es6$promise$$internal$$ErrorObject(){this.error=null}var lib$es6$promise$$internal$$TRY_CATCH_ERROR=new lib$es6$promise$$internal$$ErrorObject;function lib$es6$promise$$internal$$tryCatch(callback,detail){try{return callback(detail)}catch(e){lib$es6$promise$$internal$$TRY_CATCH_ERROR.error=e;return lib$es6$promise$$internal$$TRY_CATCH_ERROR}}function lib$es6$promise$$internal$$invokeCallback(settled,promise,callback,detail){var hasCallback=lib$es6$promise$utils$$isFunction(callback),value,error,succeeded,failed;if(hasCallback){value=lib$es6$promise$$internal$$tryCatch(callback,detail);if(value===lib$es6$promise$$internal$$TRY_CATCH_ERROR){failed=true;error=value.error;value=null}else{succeeded=true}if(promise===value){lib$es6$promise$$internal$$reject(promise,lib$es6$promise$$internal$$cannotReturnOwn());return}}else{value=detail;succeeded=true}if(promise._state!==lib$es6$promise$$internal$$PENDING){}else if(hasCallback&&succeeded){lib$es6$promise$$internal$$resolve(promise,value)}else if(failed){lib$es6$promise$$internal$$reject(promise,error)}else if(settled===lib$es6$promise$$internal$$FULFILLED){lib$es6$promise$$internal$$fulfill(promise,value)}else if(settled===lib$es6$promise$$internal$$REJECTED){lib$es6$promise$$internal$$reject(promise,value)}}function lib$es6$promise$$internal$$initializePromise(promise,resolver){try{resolver(function resolvePromise(value){lib$es6$promise$$internal$$resolve(promise,value)},function rejectPromise(reason){lib$es6$promise$$internal$$reject(promise,reason)})}catch(e){lib$es6$promise$$internal$$reject(promise,e)}}function lib$es6$promise$enumerator$$Enumerator(Constructor,input){var enumerator=this;enumerator._instanceConstructor=Constructor;enumerator.promise=new Constructor(lib$es6$promise$$internal$$noop);if(enumerator._validateInput(input)){enumerator._input=input;enumerator.length=input.length;enumerator._remaining=input.length;enumerator._init();if(enumerator.length===0){lib$es6$promise$$internal$$fulfill(enumerator.promise,enumerator._result)}else{enumerator.length=enumerator.length||0;enumerator._enumerate();if(enumerator._remaining===0){lib$es6$promise$$internal$$fulfill(enumerator.promise,enumerator._result)}}}else{lib$es6$promise$$internal$$reject(enumerator.promise,enumerator._validationError())}}lib$es6$promise$enumerator$$Enumerator.prototype._validateInput=function(input){return lib$es6$promise$utils$$isArray(input)};lib$es6$promise$enumerator$$Enumerator.prototype._validationError=function(){return new Error("Array Methods must be provided an Array")};lib$es6$promise$enumerator$$Enumerator.prototype._init=function(){this._result=new Array(this.length)};var lib$es6$promise$enumerator$$default=lib$es6$promise$enumerator$$Enumerator;lib$es6$promise$enumerator$$Enumerator.prototype._enumerate=function(){var enumerator=this;var length=enumerator.length;var promise=enumerator.promise;var input=enumerator._input;for(var i=0;promise._state===lib$es6$promise$$internal$$PENDING&&i<length;i++){enumerator._eachEntry(input[i],i)}};lib$es6$promise$enumerator$$Enumerator.prototype._eachEntry=function(entry,i){var enumerator=this;var c=enumerator._instanceConstructor;if(lib$es6$promise$utils$$isMaybeThenable(entry)){if(entry.constructor===c&&entry._state!==lib$es6$promise$$internal$$PENDING){entry._onerror=null;enumerator._settledAt(entry._state,i,entry._result)}else{enumerator._willSettleAt(c.resolve(entry),i)}}else{enumerator._remaining--;enumerator._result[i]=entry}};lib$es6$promise$enumerator$$Enumerator.prototype._settledAt=function(state,i,value){var enumerator=this;var promise=enumerator.promise;if(promise._state===lib$es6$promise$$internal$$PENDING){enumerator._remaining--;if(state===lib$es6$promise$$internal$$REJECTED){lib$es6$promise$$internal$$reject(promise,value)}else{enumerator._result[i]=value}}if(enumerator._remaining===0){lib$es6$promise$$internal$$fulfill(promise,enumerator._result)}};lib$es6$promise$enumerator$$Enumerator.prototype._willSettleAt=function(promise,i){var enumerator=this;lib$es6$promise$$internal$$subscribe(promise,undefined,function(value){enumerator._settledAt(lib$es6$promise$$internal$$FULFILLED,i,value)},function(reason){enumerator._settledAt(lib$es6$promise$$internal$$REJECTED,i,reason)})};function lib$es6$promise$promise$all$$all(entries){return new lib$es6$promise$enumerator$$default(this,entries).promise}var lib$es6$promise$promise$all$$default=lib$es6$promise$promise$all$$all;function lib$es6$promise$promise$race$$race(entries){var Constructor=this;var promise=new Constructor(lib$es6$promise$$internal$$noop);if(!lib$es6$promise$utils$$isArray(entries)){lib$es6$promise$$internal$$reject(promise,new TypeError("You must pass an array to race."));return promise}var length=entries.length;function onFulfillment(value){lib$es6$promise$$internal$$resolve(promise,value)}function onRejection(reason){lib$es6$promise$$internal$$reject(promise,reason)}for(var i=0;promise._state===lib$es6$promise$$internal$$PENDING&&i<length;i++){lib$es6$promise$$internal$$subscribe(Constructor.resolve(entries[i]),undefined,onFulfillment,onRejection)}return promise}var lib$es6$promise$promise$race$$default=lib$es6$promise$promise$race$$race;function lib$es6$promise$promise$resolve$$resolve(object){var Constructor=this;if(object&&typeof object==="object"&&object.constructor===Constructor){return object}var promise=new Constructor(lib$es6$promise$$internal$$noop);lib$es6$promise$$internal$$resolve(promise,object);return promise}var lib$es6$promise$promise$resolve$$default=lib$es6$promise$promise$resolve$$resolve;function lib$es6$promise$promise$reject$$reject(reason){var Constructor=this;var promise=new Constructor(lib$es6$promise$$internal$$noop);lib$es6$promise$$internal$$reject(promise,reason);return promise}var lib$es6$promise$promise$reject$$default=lib$es6$promise$promise$reject$$reject;var lib$es6$promise$promise$$counter=0;function lib$es6$promise$promise$$needsResolver(){throw new TypeError("You must pass a resolver function as the first argument to the promise constructor")}function lib$es6$promise$promise$$needsNew(){throw new TypeError("Failed to construct 'Promise': Please use the 'new' operator, this object constructor cannot be called as a function.")}var lib$es6$promise$promise$$default=lib$es6$promise$promise$$Promise;function lib$es6$promise$promise$$Promise(resolver){this._id=lib$es6$promise$promise$$counter++;this._state=undefined;this._result=undefined;this._subscribers=[];if(lib$es6$promise$$internal$$noop!==resolver){if(!lib$es6$promise$utils$$isFunction(resolver)){lib$es6$promise$promise$$needsResolver()}if(!(this instanceof lib$es6$promise$promise$$Promise)){lib$es6$promise$promise$$needsNew()}lib$es6$promise$$internal$$initializePromise(this,resolver)}}lib$es6$promise$promise$$Promise.all=lib$es6$promise$promise$all$$default;lib$es6$promise$promise$$Promise.race=lib$es6$promise$promise$race$$default;lib$es6$promise$promise$$Promise.resolve=lib$es6$promise$promise$resolve$$default;lib$es6$promise$promise$$Promise.reject=lib$es6$promise$promise$reject$$default;lib$es6$promise$promise$$Promise._setScheduler=lib$es6$promise$asap$$setScheduler;lib$es6$promise$promise$$Promise._setAsap=lib$es6$promise$asap$$setAsap;lib$es6$promise$promise$$Promise._asap=lib$es6$promise$asap$$asap;lib$es6$promise$promise$$Promise.prototype={constructor:lib$es6$promise$promise$$Promise,then:function(onFulfillment,onRejection){var parent=this;var state=parent._state;if(state===lib$es6$promise$$internal$$FULFILLED&&!onFulfillment||state===lib$es6$promise$$internal$$REJECTED&&!onRejection){return this}var child=new this.constructor(lib$es6$promise$$internal$$noop);var result=parent._result;if(state){var callback=arguments[state-1];lib$es6$promise$asap$$asap(function(){lib$es6$promise$$internal$$invokeCallback(state,child,callback,result)})}else{lib$es6$promise$$internal$$subscribe(parent,child,onFulfillment,onRejection)}return child},"catch":function(onRejection){return this.then(null,onRejection)}};function lib$es6$promise$polyfill$$polyfill(){var local;if(typeof global!=="undefined"){local=global}else if(typeof self!=="undefined"){local=self}else{try{local=Function("return this")()}catch(e){throw new Error("polyfill failed because global object is unavailable in this environment")}}var P=local.Promise;if(P&&Object.prototype.toString.call(P.resolve())==="[object Promise]"&&!P.cast){return}local.Promise=lib$es6$promise$promise$$default}var lib$es6$promise$polyfill$$default=lib$es6$promise$polyfill$$polyfill;var lib$es6$promise$umd$$ES6Promise={Promise:lib$es6$promise$promise$$default,polyfill:lib$es6$promise$polyfill$$default};if(typeof define==="function"&&define["amd"]){define(function(){return lib$es6$promise$umd$$ES6Promise})}else if(typeof module!=="undefined"&&module["exports"]){module["exports"]=lib$es6$promise$umd$$ES6Promise}else if(typeof this!=="undefined"){this["ES6Promise"]=lib$es6$promise$umd$$ES6Promise}lib$es6$promise$polyfill$$default()}).call(this);

/****	Fetch PolyFill library code *******/

(function(self){"use strict";if(self.fetch){return}function normalizeName(name){if(typeof name!=="string"){name=String(name)}if(/[^a-z0-9\-#$%&'*+.\^_`|~]/i.test(name)){throw new TypeError("Invalid character in header field name")}return name.toLowerCase()}function normalizeValue(value){if(typeof value!=="string"){value=String(value)}return value}function Headers(headers){this.map={};if(headers instanceof Headers){headers.forEach(function(value,name){this.append(name,value)},this)}else if(headers){Object.getOwnPropertyNames(headers).forEach(function(name){this.append(name,headers[name])},this)}}Headers.prototype.append=function(name,value){name=normalizeName(name);value=normalizeValue(value);var list=this.map[name];if(!list){list=[];this.map[name]=list}list.push(value)};Headers.prototype["delete"]=function(name){delete this.map[normalizeName(name)]};Headers.prototype.get=function(name){var values=this.map[normalizeName(name)];return values?values[0]:null};Headers.prototype.getAll=function(name){return this.map[normalizeName(name)]||[]};Headers.prototype.has=function(name){return this.map.hasOwnProperty(normalizeName(name))};Headers.prototype.set=function(name,value){this.map[normalizeName(name)]=[normalizeValue(value)]};Headers.prototype.forEach=function(callback,thisArg){Object.getOwnPropertyNames(this.map).forEach(function(name){this.map[name].forEach(function(value){callback.call(thisArg,value,name,this)},this)},this)};function consumed(body){if(body.bodyUsed){return Promise.reject(new TypeError("Already read"))}body.bodyUsed=true}function fileReaderReady(reader){return new Promise(function(resolve,reject){reader.onload=function(){resolve(reader.result)};reader.onerror=function(){reject(reader.error)}})}function readBlobAsArrayBuffer(blob){var reader=new FileReader;reader.readAsArrayBuffer(blob);return fileReaderReady(reader)}function readBlobAsText(blob){var reader=new FileReader;reader.readAsText(blob);return fileReaderReady(reader)}var support={blob:"FileReader"in self&&"Blob"in self&&function(){try{new Blob;return true}catch(e){return false}}(),formData:"FormData"in self,arrayBuffer:"ArrayBuffer"in self};function Body(){this.bodyUsed=false;this._initBody=function(body){this._bodyInit=body;if(typeof body==="string"){this._bodyText=body}else if(support.blob&&Blob.prototype.isPrototypeOf(body)){this._bodyBlob=body}else if(support.formData&&FormData.prototype.isPrototypeOf(body)){this._bodyFormData=body}else if(!body){this._bodyText=""}else if(support.arrayBuffer&&ArrayBuffer.prototype.isPrototypeOf(body)){}else{throw new Error("unsupported BodyInit type")}if(!this.headers.get("content-type")){if(typeof body==="string"){this.headers.set("content-type","text/plain;charset=UTF-8")}else if(this._bodyBlob&&this._bodyBlob.type){this.headers.set("content-type",this._bodyBlob.type)}}};if(support.blob){this.blob=function(){var rejected=consumed(this);if(rejected){return rejected}if(this._bodyBlob){return Promise.resolve(this._bodyBlob)}else if(this._bodyFormData){throw new Error("could not read FormData body as blob")}else{return Promise.resolve(new Blob([this._bodyText]))}};this.arrayBuffer=function(){return this.blob().then(readBlobAsArrayBuffer)};this.text=function(){var rejected=consumed(this);if(rejected){return rejected}if(this._bodyBlob){return readBlobAsText(this._bodyBlob)}else if(this._bodyFormData){throw new Error("could not read FormData body as text")}else{return Promise.resolve(this._bodyText)}}}else{this.text=function(){var rejected=consumed(this);return rejected?rejected:Promise.resolve(this._bodyText)}}if(support.formData){this.formData=function(){return this.text().then(decode)}}this.json=function(){return this.text().then(JSON.parse)};return this}var methods=["DELETE","GET","HEAD","OPTIONS","POST","PUT"];function normalizeMethod(method){var upcased=method.toUpperCase();return methods.indexOf(upcased)>-1?upcased:method}function Request(input,options){options=options||{};var body=options.body;if(Request.prototype.isPrototypeOf(input)){if(input.bodyUsed){throw new TypeError("Already read")}this.url=input.url;this.credentials=input.credentials;if(!options.headers){this.headers=new Headers(input.headers)}this.method=input.method;this.mode=input.mode;if(!body){body=input._bodyInit;input.bodyUsed=true}}else{this.url=input}this.credentials=options.credentials||this.credentials||"omit";if(options.headers||!this.headers){this.headers=new Headers(options.headers)}this.method=normalizeMethod(options.method||this.method||"GET");this.mode=options.mode||this.mode||null;this.referrer=null;if((this.method==="GET"||this.method==="HEAD")&&body){throw new TypeError("Body not allowed for GET or HEAD requests")}this._initBody(body)}Request.prototype.clone=function(){return new Request(this)};function decode(body){var form=new FormData;body.trim().split("&").forEach(function(bytes){if(bytes){var split=bytes.split("=");var name=split.shift().replace(/\+/g," ");var value=split.join("=").replace(/\+/g," ");form.append(decodeURIComponent(name),decodeURIComponent(value))}});return form}function headers(xhr){var head=new Headers;var pairs=xhr.getAllResponseHeaders().trim().split("\n");pairs.forEach(function(header){var split=header.trim().split(":");var key=split.shift().trim();var value=split.join(":").trim();head.append(key,value)});return head}Body.call(Request.prototype);function Response(bodyInit,options){if(!options){options={}}this.type="default";this.status=options.status;this.ok=this.status>=200&&this.status<300;this.statusText=options.statusText;this.headers=options.headers instanceof Headers?options.headers:new Headers(options.headers);this.url=options.url||"";this._initBody(bodyInit)}Body.call(Response.prototype);Response.prototype.clone=function(){return new Response(this._bodyInit,{status:this.status,statusText:this.statusText,headers:new Headers(this.headers),url:this.url})};Response.error=function(){var response=new Response(null,{status:0,statusText:""});response.type="error";return response};var redirectStatuses=[301,302,303,307,308];Response.redirect=function(url,status){if(redirectStatuses.indexOf(status)===-1){throw new RangeError("Invalid status code")}return new Response(null,{status:status,headers:{location:url}})};self.Headers=Headers;self.Request=Request;self.Response=Response;self.fetch=function(input,init){return new Promise(function(resolve,reject){var request;if(Request.prototype.isPrototypeOf(input)&&!init){request=input}else{request=new Request(input,init)}var xhr=new XMLHttpRequest;function responseURL(){if("responseURL"in xhr){return xhr.responseURL}if(/^X-Request-URL:/m.test(xhr.getAllResponseHeaders())){return xhr.getResponseHeader("X-Request-URL")}return}xhr.onload=function(){var status=xhr.status===1223?204:xhr.status;if(status<100||status>599){reject(new TypeError("Network request failed"));return}var options={status:status,statusText:xhr.statusText,headers:headers(xhr),url:responseURL()};var body="response"in xhr?xhr.response:xhr.responseText;resolve(new Response(body,options))};xhr.onerror=function(){reject(new TypeError("Network request failed"))};xhr.open(request.method,request.url,true);if(request.credentials==="include"){xhr.withCredentials=true}if("responseType"in xhr&&support.blob){xhr.responseType="blob"}request.headers.forEach(function(value,name){xhr.setRequestHeader(name,value)});xhr.send(typeof request._bodyInit==="undefined"?null:request._bodyInit)})};self.fetch.polyfill=true})(typeof self!=="undefined"?self:this);
