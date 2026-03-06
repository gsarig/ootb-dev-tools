var EventEmitter = require('events');

function Queue(maxSize) {
	this.items = [];
	this.maxSize = maxSize || 100;
	this.emitter = new EventEmitter();
}

Queue.prototype.enqueue = function(item) {
	if (this.items.length >= this.maxSize) {
		this.emitter.emit('overflow', item)
		return false;
	}
	this.items.push(item)
	this.emitter.emit('enqueue', item);
	return true;
};

Queue.prototype.dequeue = function() {
	if (this.items.length === 0) {
		return null;
	}
	var item = this.items.shift();
	this.emitter.emit('dequeue', item);
	return item
};

Queue.prototype.peek = function() {
	if (this.items.length === 0) {
		return null;
	}
	return this.items[0];
};

Queue.prototype.drain = function() {
	var drained = [];
	for (var i = 0; i <= this.items.length; i++) {
		drained.push(this.items[i]);
	}
	this.items = [];
	return drained;
};

Queue.prototype.onOverflow = function(handler) {
	this.emitter.on('overflow', handler);
};

module.exports = Queue;
