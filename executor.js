var uuid = require('node-uuid');
const crypto = require('crypto');

var Executor = function (callable) {
	var self = this;
	self.callable = callable;
	self.params = callable.params;
	if (self.params == undefined) {
		self.params = {}; 
	}
};

Executor.prototype = Executor;
Executor.prototype.constructor = Executor;
Executor.prototype.execute = function(req, res) {
	res.writeHead(200, {'Content-Type': 'text/plain'});
  	res.write("Callable is " + JSON.stringify(callable));
  	res.end();
};

Executor.prototype.getStore = function(name) {
	var storeName = name;
	if (this.callable != undefined && this.callable.stores != undefined && this.callable.stores[name] != undefined) {
		storeName = this.callable.stores[name];
	}
	if (this._http != undefined && this._http.host != undefined) {
		storeName = this._http.host + "_" + storeName;
	}
	res = require("./store").get(storeName);
	return res;
}

Executor.prototype.enrichRoutes = function(map) {
	return {};
};

Executor.prototype.enrichParameters = function(params) {
	for (var property in params) {
    	if (this.params[property] == undefined) {
      		this.params[property] = params[property];
    	}
  	}
};

CustomExecutor = function(params) {
	Executor.call(this, params);
	this._type = "CustomExecutor";
};

CustomExecutor.prototype = Object.create(Executor.prototype);
CustomExecutor.prototype.constructor = CustomExecutor;
CustomExecutor.prototype.execute = function(req, res) {
	this.params["_http"] = this._http;
};

CustomExecutor.prototype.handleResult = function(data, res) {
	try {
		// Should parse JSON
      	var result = JSON.parse(data);		
      	if (result.code == undefined) {
      		result.code = 200;
      	}
      	if (result.headers == undefined) {
      		result.headers = {}
      	}
      	if (result.headers['Content-Type'] == undefined) {
      		result.headers['Content-Type'] = 'application/json';
      	}
      	if (result.code == 200 && (result.content == undefined || result.content == "")) {
      		result.code = 204;
      	}
    } catch(err) {
      	console.log("Error '" + err + "' parsing result: " + data);
      	res.writeHead(500);
      	res.end();
		return;
	}
	res.writeHead(result.code, result.headers);
	if (result.content != undefined) {
    	res.write(result.content);
    }
    res.end();
}

var AWS = require('aws-sdk');

LambdaExecutor = function(params) {
	CustomExecutor.call(this, params);
	this._type = "LambdaExecutor";
};

LambdaExecutor.prototype = Object.create(CustomExecutor.prototype);
LambdaExecutor.prototype.constructor = LambdaExecutor;
LambdaExecutor.prototype.execute = function(req, res) {
	var self = this;
	console.log(AWS.Config);
	AWS.config.update({region: 'us-west-2'});
	AWS.config.update({accessKeyId: this.params['accessKeyId'], secretAccessKey: this.params['secretAccessKey']});
	var lambda = new AWS.Lambda();
	this.params["_http"] = this._http;
	var params = {
		FunctionName: this.callable['lambda'], /* required */
		ClientContext: null,
		InvocationType: 'RequestResponse',
		LogType: 'None',
		Payload: JSON.stringify(this['params'])// not sure here / new Buffer('...') || 'STRING_VALUE'
    };
  	lambda.invoke(params, function(err, data) {
    	if (err) {
      		console.log(err, err.stack);
      		res.writeHead(500, {'Content-Type': 'text/plain'});
      		res.end();
      		return;
    	}
    	if (data.Payload != '{}') {
    		self.handleResult(data.Payload, res);
    	}
  	});
};

var fs = require('fs');
var mime = require('mime-types');

ResourceExecutor = function(params) {
	Executor.call(this, params);
	this._type = "ResourceExecutor";
};

ResourceExecutor.prototype = Object.create(Executor.prototype);
ResourceExecutor.prototype.constructor = ResourceExecutor;
ResourceExecutor.prototype.execute = function(req, res) {
	var self = this;
	fs.readFile(this.callable.file, 'utf8', function (err,data) {
	  if (err) {
	    return console.log(err);
	  }
	  var mime_file = mime.lookup(self.callable.file);
	  console.log("Send file('" + mime_file + "'): " + self.callable.file);
	  if (mime_file) {
	  	res.writeHead(200, {'Content-Type': mime_file});
	  }
	  res.write(data);
	  res.end();
	});
};

FileExecutor = function(params) {
	CustomExecutor.call(this, params);
	this._type = "FileExecutor";
};

FileExecutor.prototype = Object.create(CustomExecutor.prototype);
FileExecutor.prototype.constructor = FileExecutor;
FileExecutor.prototype.execute = function(req, res) {
	req.context = this.params;
	req.context.getStore = this.getStore;
	if (this.callable.type == "lambda") {
		// MAKE IT local compatible
		var data = require(this.callable.file)(params, {});
		this.handleResult(data, res);
	} else {
		require(this.callable.file)(req, res);
	}
};

StringExecutor = function(params) {
	Executor.call(this, params);
	this._type = "StringExecutor";
};

StringExecutor.prototype = Object.create(Executor.prototype);

StringExecutor.prototype.execute = function(req, res) {
	if (this.callable.mime) {
	   res.writeHead(200, {'Content-Type': this.callable.mime});
	}
	if (typeof this.callable.result != "string") {
		res.write(JSON.stringify(this.callable.result));
	} else {
		res.write(this.callable.result);
	}
	res.end();
};

InlineExecutor = function(params) {
	Executor.call(this, params);
	this._type = "InlineExecutor";
};

InlineExecutor.prototype = Object.create(Executor.prototype);
InlineExecutor.prototype.constructor = InlineExecutor;
InlineExecutor.prototype.execute = function(req, res) {
	console.log("Will evaluate : " + this.callable.callback);
	eval("callback = " + this.callable.callback);
	console.log("Inline Callback type: " + typeof(callback));
	req.context = this.params;
	if (typeof(callback) == "function") {
		callback(req, res);
		console.log("end executing inline");
	} else {
		console.log("Cant execute the inline as it is not a function");
		res.writeHead(500);
		res.end();
	}
}

StoreExecutor = function(params) {
	Executor.call(this, params);
	this._type = "StoreExecutor";
};

StoreExecutor.prototype = Object.create(Executor.prototype);
StoreExecutor.prototype.constructor = StoreExecutor;
StoreExecutor.prototype.checkAuthentication = function(req, res, object) {
	if (this.callable.expose.restrict.authentication) {
		var field = "user";
		if (typeof(this.callable.expose.restrict.authentication) == "string") {
			field = this.callable.expose.restrict.authentication;
		}
		if (req.session.currentuser == undefined || req.session.currentuser.uuid != object[field]) {
			throw 403;
		}
	}
	return true;
}
StoreExecutor.prototype.execute = function(req, res) {
	var store = require("./store").get(this.callable.store);
	if (store == undefined) {
		console.log("Unkown store: " + this.callable.store);
		res.writeHead(500);
		res.end();
		return;
	}
	if (this._http.method == "GET") {
		if (this.callable.expose.restrict != undefined
				&& this.callable.expose.restrict.get) {
			throw 404;
		}
		if (this.params.uuid) {
			var object = store.get(this.params.uuid);
                        if (object === undefined) {
                            throw 404;
                        }
			if (!this.checkAuthentication(req, res, object)) {
				return;
			}
			res.writeHead(200, {'Content-type': 'application/json'});
			result = {}
			for (prop in object) {
				// Server private property
				if (prop[0] == "_") {
					continue
				}
				result[prop] = object[prop]
			}
                        res.write(JSON.stringify(result));
			res.end();
			return;
		} else {
			// List probably
		}
	} else if (this._http.method == "DELETE") {
		if (this.callable.expose.restrict != undefined
				&& this.callable.expose.restrict.delete) {
			throw 404;
		}
		var object = store.get(this.params.uuid);
		if (object === undefined) {
			throw 404;
		}
		if (!this.checkAuthentication(req, res, object)) {
			return;
		}
		if (this.params.uuid) {
			store.delete(this.params.uuid);
			throw 204;
		}
	} else if (this._http.method == "POST") {
		var object = req.body;
		if (this.callable.expose.restrict != undefined
				&& this.callable.expose.restrict.create) {
			throw 404;
		}
		if (this.callable.expose.restrict.authentication) {
			if (req.session.currentuser == undefined) {
				throw 401;
			}
			object.user = req.session.currentuser.uuid;
		}
		if (!object.uuid) {
			object.uuid = uuid.v4();
		}
		if (store.exists(object.uuid)) {
			throw 409;
		}
		for (prop in object) {
			if (prop[0] == "_") {
				delete object[prop]
			}
		}
		var new_object = store.save(object, object.uuid);
		res.writeHead(200, {'Content-type': 'application/json'});
		res.write(JSON.stringify(new_object));
		res.end();
		return;
	} else if (this._http.method == "PUT") {
		if (this.callable.expose.restrict != undefined
				&& this.callable.expose.restrict.update) {
			throw 404;
		}
		if (!store.exists(this.params.uuid)) {
			throw 404;
		}
		if (this.callable.expose.restrict.authentication) {
			var currentObject = store.get(this.params.uuid);
			if (!this.checkAuthentication(req, res, currentObject)) {
				return;
			}
		}
		for (prop in req.body) {
			if (prop[0] == "_") {
				delete req.body[prop]
			}
		}
		var object = store.update(req.body, this.params.uuid);
		if (object == undefined) {
			throw 500;
		}
		res.writeHead(200, {'Content-type': 'application/json'});
		res.write(JSON.stringify(object));
		res.end();
		return;
	}
	throw 404;
}

var passport = require('passport');
var TwitterStrategy = require('passport-twitter').Strategy;
var FacebookStrategy = require('passport-facebook').Strategy;
var GitHubStrategy = require('passport-github2').Strategy;
var GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;

var Ident = function (type, uid, accessToken, refreshToken) {
	this.type = type;
	this.uid = uid;
	this.uuid = uid + "_" + type;
	this.tokens = {};
	this.tokens.refresh = refreshToken;
	this.tokens.access = accessToken;
}

Ident.prototype = Ident;

Ident.prototype.getUser = function() {
	return this.user;
}

Ident.prototype.setUser = function(user) {
	this.user = user;
}

Ident.prototype.setMetadatas = function(meta) {
	this.metadatas = meta;
}

Ident.prototype.getMetadatas = function() {
	return this.metadatas;
}

passport.serializeUser(function(user, done) {
  done(null, JSON.stringify(user));
});

passport.deserializeUser(function(id, done) {
  done(null, JSON.parse(id));
});

PassportExecutor = function(params) {
	Executor.call(this, params);
	this._type = "PassportExecutor";
}

PassportExecutor.prototype = Object.create(Executor.prototype);
PassportExecutor.prototype.constructor = PassportExecutor;

PassportExecutor.prototype.enrichRoutes = function(map) {
	var result = {};
	result[map+'/callback']={};
	result[map+'/return']={};
	return result;
};

PassportExecutor.prototype.executeCallback = function(req, res) {
	var self = this;
	next = function (err) {
		console.log("Error happened: " + err);
		console.trace();
	}
	switch (self.params.provider) {
		case "facebook":
			self.setupFacebook(req, res);
			passport.authenticate('facebook', { successRedirect: self.callable.successRedirect, failureRedirect: self.callable.failureRedirect})(req, res, next);
                        break;
		case "google":
			self.setupGoogle(req, res);
			passport.authenticate('google', { successRedirect: self.callable.successRedirect, failureRedirect: self.callable.failureRedirect})(req, res, next);
                        break;
		case "github":
			self.setupGithub(req, res);
			passport.authenticate('github', { successRedirect: self.callable.successRedirect, failureRedirect: self.callable.failureRedirect})(req, res, next);
                        break;
		case "email":
			self.handleEmailCallback(req, res);
			break;
		case "phone":
			self.handlePhoneCallback(req, res);
			break;
	}
};

PassportExecutor.prototype.getCallback = function () {
	var self = this;
	if (self.callable._extended) {
		callback = self._http.protocol + "://" + self._http.host + self._http.url;
	} else {
		callback = self._http.protocol + "://" + self._http.host + self._http.url + "/callback";
	}
	return callback;
};

PassportExecutor.prototype.setupGithub = function(req, res) {
	var self = this;
	var callback = self.getCallback();
	passport.use(new GitHubStrategy({
		    clientID: self.callable.providers.github.clientID,
		    clientSecret: self.callable.providers.github.clientSecret,
		    callbackURL: callback
		},
		function(accessToken, refreshToken, profile, done) {
		    console.log("return from github: " + JSON.stringify(profile));
		    req.session.authenticated = new Ident("github", profile.id, accessToken, refreshToken);
		    req.session.authenticated.setMetadatas(profile._json);
		    self.store(req.session);
		    done(null, req.session.authenticated);
		}
	));
}

PassportExecutor.prototype.setupGoogle = function(req, res) {
	var self = this;
	var realm = self.callable.providers.google.realm;
	var callback = self.getCallback();
	if (realm == null) {
		realm = callback;
	}
	passport.use(new GoogleStrategy({
    		clientID: this.callable.providers.google.clientID,
            clientSecret: this.callable.providers.google.clientSecret,
  			callbackURL: callback
		},
		function(accessToken, refreshToken, profile, done) {
		    console.log("return from google: " + JSON.stringify(profile));
            req.session.authenticated = new Ident("google", profile.id, accessToken, refreshToken);
            // Dont store useless parts
            delete profile._raw;
            delete profile._json;
		    req.session.authenticated.setMetadatas(profile);
		    self.store(req.session);
		    done(null, req.session.authenticated);
		}
	));
}

PassportExecutor.prototype.store = function(session) {
	var self = this;
	var identStore = this.getStore("idents");
	if (identStore == undefined) {
		return;
	}
	var identObj = identStore.get(session.authenticated.uuid);
	if (identObj == undefined) {
		identObj = session.authenticated;
		if (identObj.user == undefined && session.currentuser != undefined) {
			identObj.user = session.currentuser.uuid;
		}
		identStore.save(identObj);
	} else {
		updates = {};
		if (identObj.user == undefined && session.currentuser != undefined) {
			updates.user = session.currentuser.uuid;
		}
		updates.lastUsed = new Date();
		updates.metadatas = session.authenticated.metadatas;
		identObj = identStore.update(updates, identObj.uuid);
	}
	// TODO Add an update method for updating only attribute
	if (identObj.user != undefined) {
		userStore = self.getStore("users");
		if (userStore == undefined) {
			return;
		}
		session.currentuser = userStore.get(identObj.user);
	}
}

PassportExecutor.prototype.setupFacebook = function(req, res) {
	var self = this;
	var callback = self.getCallback();
	passport.use(new FacebookStrategy({
		    clientID: self.callable.providers.facebook.clientID,
		    clientSecret: self.callable.providers.facebook.clientSecret,
		    callbackURL: callback
		},
		function(accessToken, refreshToken, profile, done) {
		    console.log("return from fb: " + JSON.stringify(profile));
            req.session.authenticated = new Ident("facebook", profile.id, accessToken, refreshToken);
            // Dont store useless parts
            delete profile._raw;
            delete profile._json;
		    req.session.authenticated.setMetadatas(profile);
		    self.store(req.session);
		    done(null, req.session.authenticated);
		}
	));
}

PassportExecutor.prototype.handleEmailCallback = function(req, res) {
	var identStore = this.getStore("idents");
	if (identStore === undefined) {
		res.writeHead(500);
		console.log("Email auth needs an ident store");
		res.end();
		return;
	}
	var updates = {};
	var uuid = req.body.login + "_email";
	var ident = identStore.get(uuid);
	if (ident != undefined && ident.user != undefined) {
		var userStore = this.getStore("users");
		var user = userStore.get(ident.user);
		var hash = crypto.createHash('sha256');
		// Check password
		if (user._password === hash.update(req.body.password).digest('hex')) {
			req.session.authenticated = ident;
			if (ident.failedLogin > 0) {
				ident.failedLogin = 0;
			}
			updates.lastUsed = new Date();
			updates.failedLogin = 0;
			ident = identStore.update(updates, ident.uuid);
			req.session.authenticated = ident;
			res.writeHead(204);
		} else {
			if (ident.failedLogin === undefined) {
				ident.failedLogin = 0;
			}
			updates.failedLogin = ident.failedLogin++;
			updates.lastFailedLogin = new Date();
			ident = identStore.update(updates, ident.uuid);
			throw 403;
		}
	} else {
		// Read the form
		throw 404;
	}
	// Should send an email
	res.end();
}

PassportExecutor.prototype.handlePhoneCallback = function(req, res) {

}

PassportExecutor.prototype.handleEmail = function(req, res) {
	var identStore = this.getStore("idents");
	if (identStore === undefined) {
		res.writeHead(500);
		console.log("Email auth needs an ident store");
		res.end();
		return;
	}
	var uuid = "" + "_email";
	console.log(identStore);
	var ident = identStore.get(uuid);
	if (ident != undefined && ident.user != undefined) {
		var userStore = this.getStore("users");
		var user = userStore.get(ident.user);
		// Check password
		res.end();
	}
	// Read the form
	res.writeHead(204);
	// Should send an email
}

PassportExecutor.prototype.handlePhone = function(req, res) {
	res.writeHead(204);
}

PassportExecutor.prototype.execute = function(req, res) {
	var self = this;
	req._passport = {};
	req._passport.instance = passport;
	req._passport.session = req.session;
	if (self.callable._extended ) {
		self.executeCallback(req, res);
		return;
	}
	var next = function(err) {
		console.log("Error happened: " + err);
		console.trace();
	}
	switch (self.params.provider) {
		case "google":
			self.setupGoogle();
			passport.authenticate('google', {'scope': self.callable.providers.google.scope})(req, res, next);
			break;
		case "facebook":
			self.setupFacebook();
			passport.authenticate('facebook', {'scope': self.callable.providers.facebook.scope})(req, res, next);
			break;
		case "github":
			self.setupGithub();
			passport.authenticate('github', {'scope': self.callable.providers.github.scope})(req, res, next);
			break;
		case "phone":
			this.handlePhone(req, res);
			break;
		case "email":
			this.handleEmail(req, res);
			break;
	}
	res.end();
};

FileBinaryExecutor = function(params) {
	Executor.call(this, params);
	this._type = "FileBinaryExecutor";
	console.log(params);
	if (!fs.existsSync(params.binary.folder)) {
		fs.mkdirSync(params.binary.folder);
	}
};

FileBinaryExecutor.prototype = Object.create(Executor.prototype);
FileBinaryExecutor.prototype.constructor = FileBinaryExecutor;

FileBinaryExecutor.prototype.execute = function(req, res) {
	var self = this;
	var targetStore = this.getStore(this.params.store);
	if (targetStore === undefined) {
		throw 404;
	}
	var object = targetStore.get(this.params.uid);
	if (object === undefined) {
		throw 404;
	}
	if (object[this.params.property] !== undefined && typeof(object[this.params.property]) !== 'object') {
		throw 403;
	}
	var file;
	if (this._http.method == "POST") {
		var hash = crypto.createHash('sha256');
		var bytes;
		if (req.files !== undefined) {
			file = req.files[0];
		} else {
			file = {};
			file.buffer = req.body;
			file.mimetype = req.headers.contentType;
			file.size = len(req.body);
			file.originalname = '';
		}
		var hashValue = hash.update(file.buffer).digest('hex');
		// TODO Dont overwrite if already there
		fs.writeFile(this.callable.binary.folder + hashValue, file.buffer, function (err) {
			var update = {};
			update[self.params.property] = object[self.params.property];
			if (update[self.params.property] === undefined) {
				update[self.params.property] = [];
			}
			var fileObj = {};
			for (var i in req.body) {
				fileObj[i] = req.body[i];
			}
			fileObj['name']=file.originalname;
			fileObj['mimetype']=file.mimetype;
			fileObj['size']=file.size;
			fileObj['hash']=hashValue;
			update[self.params.property].push(fileObj);
			targetStore.update(update, self.params.uid);
	    	res.writeHead(200, {'Content-type': 'application/json'});
			res.write(JSON.stringify(targetStore.get(self.params.uid)));
	    	res.end();
	  	});
	} else if (this._http.method == "GET") {
		if (object[this.params.property] === undefined || object[this.params.property][this.params.index] === undefined) {
			throw 404;
		}
		file = object[this.params.property][this.params.index];
		res.writeHead(200, {
        	'Content-Type': file.mimetype,
        	'Content-Length': file.size
	    });

	    var readStream = fs.createReadStream(this.callable.binary.folder + file.hash);
	    // We replaced all the event handlers with a simple call to readStream.pipe()
	    readStream.pipe(res);
	} else if (this._http.method == "DELETE") {
		if (object[this.params.property] === undefined || object[this.params.property][this.params.index] === undefined) {
			throw 404;
		}
		var update = {};
		if (object[self.params.property][this.params.index].hash !== this.params.hash) {
			throw 412;
		}
		update[self.params.property] = object[self.params.property];
		update[self.params.property].slice(this.params.index, 1);
		targetStore.update(update, self.params.uid);
		// TODO Delete binary or update its count
	    res.writeHead(200, {'Content-type': 'application/json'});
		res.write(JSON.stringify(targetStore.get(self.params.uid)));
		res.end();
	} else if (this._http.method == "PUT") {
		if (object[this.params.property] === undefined || object[this.params.property][this.params.index] === undefined) {
			throw 404;
		}
		var update = {};
		if (object[self.params.property][this.params.index].hash !== this.params.hash) {
			throw 412;
		}
		// Should avoid duplication
		var hash = crypto.createHash('sha256');
		var bytes;
		if (req.files !== undefined) {
			file = req.files[0];
		} else {
			file = {};
			file.buffer = req.body;
			file.mimetype = req.headers.contentType;
			file.size = len(req.body);
			file.originalname = '';
		}
		var hashValue = hash.update(file.buffer).digest('hex');
		// TODO Dont overwrite if already there
		fs.writeFile(this.callable.binary.folder + hashValue, file.buffer, function (err) {
			var update = {};
			update[self.params.property] = object[self.params.property];
			if (update[self.params.property] === undefined) {
				update[self.params.property] = [];
			}
			var fileObj = {};
			for (var i in req.body) {
				fileObj[i] = req.body[i];
			}
			fileObj['name']=file.originalname;
			fileObj['mimetype']=file.mimetype;
			fileObj['size']=file.size;
			fileObj['hash']=hashValue;
			update[self.params.property] = object[self.params.property];
			update[self.params.property][self.params.index]=fileObj;
			targetStore.update(update, self.params.uid);
	    	res.writeHead(200, {'Content-type': 'application/json'});
			res.write(JSON.stringify(targetStore.get(self.params.uid)));
	    	res.end();
	  	});
	}
};

module.exports = {"_default": LambdaExecutor, "custom": CustomExecutor, "inline": InlineExecutor, "lambda": LambdaExecutor, "debug": Executor, "store": StoreExecutor, "string": StringExecutor, "resource": ResourceExecutor, "file": FileExecutor , "passport": PassportExecutor, "filebinary": FileBinaryExecutor}; 
