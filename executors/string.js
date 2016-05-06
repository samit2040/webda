"use strict";
const Executor = require('./executor.js');

class StringExecutor extends Executor {

	execute() {
		if (this._params.mime) {
		   this.writeHead(200, {'Content-Type': this._params.mime});
		}
		if (typeof this._params.result != "string") {
			this.write(JSON.stringify(this._params.result));
		} else {
			this.write(this._params.result);
		}
		this.end();
	}
}

module.exports = StringExecutor