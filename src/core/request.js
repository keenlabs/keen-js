var each = require('./utils/each'),
    extend = require('./utils/extend'),
    sendQuery = require('./utils/sendQuery'),
    sendSavedQuery = require('./utils/sendSavedQuery');

var Emitter = require('./utils/emitter-shim');
var Keen = require('./');
var Query = require('./query');

function Request(client, queries, callback){
  var cb = callback;
  this.config = {
    timeout: 300 * 1000
  };
  this.configure(client, queries, cb);
  cb = callback = null;
  this._activeQueries = [];
  this._isAborted = false;
};
Emitter(Request.prototype);

Request.prototype.configure = function(client, queries, callback){
  var cb = callback;
  extend(this, {
    'client'   : client,
    'queries'  : queries,
    'data'     : {},
    'callback' : cb
  });
  cb = callback = null;
  return this;
};

Request.prototype.timeout = function(ms){
  if (!arguments.length) return this.config.timeout;
  this.config.timeout = (!isNaN(parseInt(ms)) ? parseInt(ms) : null);
  return this;
};

// Abort all remaining requests
Request.prototype.abort = function(){
  this._isAborted = true;
  this._activeQueries.forEach(function(query) {
    query.abort();
  });
  this._activeQueries = [];
  return this;
}

Request.prototype.refresh = function(){
  var self = this,
      completions = 0,
      response = [],
      errored = false;
  this._isAborted = false;

  var handleResponse = function(err, res, index){
    if (errored || self._isAborted) {
      return;
    }
    if (err) {
      self.trigger('error', err);
      if (self.callback) {
        self.callback(err, null);
      }
      errored = true;
      return;
    }
    response[index] = res;
    completions++;
    if (completions == self.queries.length && !errored) {
      self.data = (self.queries.length == 1) ? response[0] : response;
      self.trigger('complete', null, self.data);
      if (self.callback) {
        self.callback(null, self.data);
      }
    }
    self._activeQueries.splice(index, 1);
  };

  each(self.queries, function(query, index){
    var cbSequencer = function(err, res){
      handleResponse(err, res, index);
    };
    var path = '/queries';

    if (typeof query === 'string') {
      path += '/saved/' + query + '/result';
      self._activeQueries[index] = sendSavedQuery.call(self, path, {}, cbSequencer);
    }
    else if (query instanceof Query) {
      path += '/' + query.analysis;
      if (query.analysis === 'saved') {
        path += '/' + query.params.query_name + '/result';
        self._activeQueries[index] = sendSavedQuery.call(self, path, {}, cbSequencer);
      }
      else {
        self._activeQueries[index] = sendQuery.call(self, path, query.params, cbSequencer);
      }
    }
    else {
      var res = {
        statusText: 'Bad Request',
        responseText: { message: 'Error: Query ' + (+index+1) + ' of ' + self.queries.length + ' for project ' + self.client.projectId() + ' is not a valid request' }
      };
      self.trigger('error', res.responseText.message);
      if (self.callback) {
        self.callback(res.responseText.message, null);
      }
    }
  });
  return this;
};

module.exports = Request;
