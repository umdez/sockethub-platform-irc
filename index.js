/**
 * This is a platform for sockethub implementing IRC functionality.
 *
 * copyright 2012-2015 Nick Jennings (https://github.com/sil@typeucket)
 *
 * sockethub is licensed under the LGPLv3.
 * See the LICENSE file for details.
 *
 * The latest version of this module can be found here:
 *   git://github.com/sockethub/sockethub-platform-irc.git
 *
 * For more information about sockethub visit http://sockethub.org/.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 */

if (typeof (IRCFactory) !== 'object') {
  IRCFactory = require('irc-factory');
}

var debug = require('debug')('sockethub-platform-irc'),
    api   = new IRCFactory.Api();

var packageJSON = require('./package.json');


/**
 * Class: IRC
 *
 * Handles all actions related to communication via. the IRC protocol.
 *
 * Uses the `irc-factory` node module as a base tool for interacting with IRC.
 *
 * https://github.com/ircanywhere/irc-factory
 *
 * @constructor
 * @param {object} Sockethub session object 
 * 
 */
function IRC(session) {
  this.session   = session;
  this._channels = [];
}

/**
 * Property: schema
 *
 * JSON schema defining the @types this platform accepts.
 *
 * Actual handling of incoming 'set' commands are handled by dispatcher,
 * but the dispatcher uses this defined schema to validate credentials
 * received, so that when a @context @type is called, it can fetch the
 * credentials (`session.getConfig()`), knowing they will have already been
 * validated against this schema.
 *
 *
 * In the below example, sockethub will validate the incoming credentials object
 * against whatever is defined in the `credentials` portion of the schema
 * object.
 *
 *
 * 
 * It will also check if the incoming AS object uses a @type which exists in the
 * `@types` portion of the schema object (should be an array of @type names).
 *
 * 
 * @example
 * Valid AS object for setting IRC credentials:
 *
 *  {
 *    '@type': 'set',
 *    context: 'irc',
 *    actor: {
 *      '@id': 'irc://testuser@irc.host.net',
 *      '@type': 'person',
 *      displayName: 'Mr. Test User',
 *      userName: 'testuser'
 *    },
 *    object: {
 *      '@type': 'credentials',
 *      server: 'irc.host.net',
 *      nick: 'testuser',
 *      password: 'asdasdasdasd',
 *      port: 6697,
 *      secure: true
 *    }
 *  }
 *
 * 
 */
IRC.prototype.schema = {
  "version": packageJSON.version,
  "messages" : {
    "required": [ '@type' ],
    "properties": {
      "@type": {
        "enum": [ 'update', 'join', 'leave', 'send', 'observe', 'announce' ]
      }
    }
  },
  "credentials" : {
    "required": [ 'object' ],
    "properties": {
      // TODO platforms shouldn't have to define the actor property if they don't want to, just credential specifics
      "actor": {
        "type": "object",
        "required": [ "@id", "displayName" ]
      },
      "object": {
        "name": "object",
        "type": "object",
        "required": [ '@type', 'nick', 'server' ],
        "additionalProperties": false,
        "properties" : {
          "@type": {
            "name": "@type",
            "type": "string"
          },
          "nick" : {
            "name" : "nick",
            "type": "string"
          },
          "password" : {
            "name" : "password",
            "type": "string"
          },
          "server" : {
            "name" : "server",
            "type": "string"
          },
          "port" : {
            "name": "port",
            "type": "number"
          },
          "secure": {
            "name": "secure",
            "type": "boolean"
          }
        }
      }
    }
  }
};


var createObj = {
  timeout: 30000,
  connect: function (cb) {
    var client;
    var _this = this;
    var key = this.credentials.actor['@id'];
    var is_secure = (typeof this.credentials.object.secure === 'boolean') ? this.credentials.object.secure : true;
    var module_creds = {
      nick: this.credentials.object.nick,
      user: this.credentials.object.nick,
      server: this.credentials.object.server || 'irc.freenode.net',
      realname: this.credentials.actor.displayName || this.credentials.object.nick,
      secure: is_secure,
      port: (this.credentials.object.port) ? parseInt(this.credentials.object.port, 10) : (is_secure) ? 6697 : 6667,
    };

    function onRegister(object) {
      _this.scope.debug('connected to ' + module_creds.server);
      api.unhookEvent(key, 'registered');
      api.unhookEvent(key, '*');
      cb(null, client);
    }
    api.unhookEvent(key, '*');

    api.hookEvent(key, '*', function (message) {
      if ((typeof message === 'object') && (typeof message.capabilities === 'object')) {
        _this.scope.send({
          '@type': 'announce',
          actor: {
            '@type': 'service',
            '@id': 'irc://' + _this.credentials.object.server
          },
          target: {
            '@type': 'person',
            '@id': 'irc://' + _this.credentials.actor['@id'] + '@' + _this.credentials.object.server
          },
          object: {
            '@type': 'content',
            content: message.capabilities
          },
          published: message.time
        });
      } else {
        debug('*: ' + JSON.stringify(message));
      }
    });

    api.hookEvent(key, 'registered', onRegister);

    this.scope.debug('attempting to connect to ' + module_creds.server + ':' + module_creds.port + ' [secure:' + is_secure + ']');

    // connect...
    client = api.createClient(key, module_creds);
  },
  listeners: {
    '*': function (object) {
      //debug('HANDLER * called [' + this.id + ']: ', object);
      if (typeof object.names === 'object') {
        // user list
        this.scope.debug('received user list: ' + object.channel);
        this.scope.send({
          '@type': 'observe',
          actor: {
            '@type': 'room',
            '@id': 'irc://' + this.credentials.object.server + '/' + object.channel,
            displayName: object.channel
          },
          target: {
            '@type': 'room',
            '@id': 'irc://' + this.credentials.object.server + '/' + object.channel,
            displayName: object.channel
          },
          object: {
            '@type': 'attendance',
            members: object.names
          },
          published: object.time
        });
      } else if ((typeof object.channel === 'string') &&
                 (typeof object.who === 'object')) {
        // full who
      } else if ((typeof object.topic === 'string') &&
                 (typeof object.topicBy === 'string')) {
        // topic
        this.scope.debug('received topic change list: ' + object.channel + ':' + object.topicBy + ': ' + object.topic);
        this.scope.send({
          '@type': 'update',
          actor: {
            '@type': 'person',
            '@id': 'irc://' + object.topicBy + '@' + this.credentials.object.server,
            displayName: object.topicBy
          },
          target: {
            '@type': 'room',
            '@id': 'irc://' + this.credentials.object.server + '/' + object.channel,
            displayName: object.channel
          },
          object: {
            '@type': 'topic',
            topic: object.topic
          },
          published: object.time
        });
      } else if (typeof object.newnick === 'string') {
        // nick change
        this.scope.debug('received nick change ' + object.nickname + ' -> ' + object.newnick);
        this.scope.send({
          '@type': 'update',
          actor: {
            '@type': 'person',
            '@id': 'irc://' + object.nickname + '@' + this.credentials.object.server,
            displayName: object.nickname
          },
          target: {
            '@type': 'person',
            '@id': 'irc://' + object.newnick + '@' + this.credentials.object.server,
            displayName: object.newnick
          },
          object: {
            '@type': 'address'
          },
          published: object.time
        });
      } else if ((typeof object.channel === 'string') &&
                 (object.raw.indexOf(' JOIN ') >= 0)) {
        // join
        this.scope.debug('received join: ' + object.nickname + ' -> ' + object.channel, object);
        if (!object.nickname) {
          this.scope.debug('skipping join message with undefined nickname');
        } else {
          this.scope.send({
            '@type': 'join',
            actor: {
              '@type': 'person',
              '@id': 'irc://' + object.nickname + '@' + this.credentials.object.server,
              displayName: object.nickname
            },
            target: {
              '@type': 'room',
              '@id': 'irc://' + this.credentials.object.server + '/' + object.channel,
              displayName: object.channel
            },
            object: {},
            published: object.time
          });
        }
      } else if ((typeof object.target === 'string') &&
                 (typeof object.message === 'string')) {
        // message
        if (!object.nickname) {
          this.scope.debug('received UNKNOWN: ', object);
        } else {
          this.scope.debug('received message: ' + object.nickname + ' -> ' + object.target);
          this.scope.send({
            '@type': 'send',
            actor: {
              '@type': 'person',
              '@id': 'irc://' + object.nickname + '@' + this.credentials.object.server,
              displayName: object.nickname
            },
            target: {
              displayName: object.target
            },
            object: {
              '@type': 'message',
              content: object.message
            },
            published: object.time
          });
        }
      } else if (typeof object.motd === 'object') {
        // skip
      } else if (typeof object.mode === 'string') {
        // skip
      } else if ((typeof object.nickname === 'string') &&
                 (typeof object.capabilities === 'object') &&
                 (typeof object.time === 'string') &&
                 (typeof object.raw === 'object')) {
        // registered
        debug('registered! ', object);
      } else if ((object.reconnecting === true) &&
                 (typeof object.attempts === 'number')) {
        // disconected, reconnecting
        debug('disconnected, reconnecting. for ' + this.id);
        this.connection.irc.reconnect();
      } else if ((typeof object.nickname === 'string') &&
                 (typeof object.target === 'undefined')) {
        // QUIT
        this.scope.debug('received quit: ' + object.nickname + ' (self: ' + this.credentials.actor.displayName + ')', object);

        if (! this.scope.disconnected) {
          this.scope.send({
            '@type': 'leave',
            actor: {
              '@type': 'person',
              '@id': 'irc://' + object.nickname + '@' + this.credentials.object.server,
              displayName: object.nickname
            },
            target: {},
            object: {
              '@type': 'message',
              content: 'user has quit'
            },
            published: object.time
          });
        }

        if (object.nickname === this.credentials.actor.displayName) {
          this.scope.debug('disconnecting self');
          if (this.connection) {
            this.connection.irc.disconnect();
          }
          this.scope.disconnected = true;
        }
      } else if ((typeof object.channel === 'string') &&
                 (object.raw.indexOf(' PART ') >= 0)) {
        // leave
        this.scope.debug('received leave: ' + object.nickname + ' -> ' + object.target, object);
        this.scope.send({
          '@type': 'leave',
          actor: {
            '@type': 'person',
            '@id': 'irc://' + object.nickname + '@' + this.credentials.object.server,
            displayName: object.nickname
          },
          target: {
            '@type': 'room',
            '@id': 'irc://' + this.credentials.object.server + '/' + object.target,
            displayName: object.target
          },
          object: {
            '@type': 'message',
            content: 'user has left the channel'
          },
          published: object.time
        });
      } else {
        debug('HANDLER * called [' + this.id + ']: ', object);
      }
    }
  },
  addListener: function (name, func) {
    this.scope.debug('addListener called! ' + this.id + ' ' + name);
    api.hookEvent(this.id, name, func);
  },
  removeListener: function (name, func) {
    this.scope.debug('removeListener called!');
    api.unhookEvent(this.id, name);
  },
  isConnected: function () {
    debug('isConnected() called, returning: ' + this.connection.irc.isConnected());
    return this.connection.irc.isConnected();
  },
  disconnect: function (cb) {
    this.scope.debug('disconnect for ' + this.id);
    this.scope.quit = true;
    api.destroyClient(this.id);
    cb();
  }
};

/**
 * Function: join
 *
 * Join a room or private conversation.
 *
 * @param {object} - Activity streams job object
 * @param {object} - callback when complete
 *
 * @example
 *
 * {
 *   context: 'irc',
 *   '@type': 'join',
 *   actor: {
 *     '@id': 'irc://slvrbckt@irc.freenode.net',
 *     '@type': 'person',
 *     displayName: 'slvrbckt'
 *   },
 *   target: {
 *     '@id': 'irc://irc.freenode.net/sockethub',
 *     '@type': 'room',
 *     displayName: '#sockethub'
 *   },
 *   object: {}
 * }
 *
 */
IRC.prototype.join = function (job, done) {
  var self = this;

  self.session.debug('join() called for ' + job.actor['@id']);

  self.session.client.get(job.actor['@id'], createObj, function (err, client) {
    if (err) { return done(err); }
    self.session.debug('got client for ' + job.actor['@id']);
    // join channel
    self.session.debug('join: ' + job.actor.displayName + ' -> ' + job.target.displayName);
    client.connection.irc.raw(['JOIN', job.target.displayName]);
    self._joined(job.target.displayName);

    done();
  });
};

/**
 * Function: leave
 *
 * Leave a room or private conversation.
 *
 * @param {object} - Activity streams job object
 * @param {object} - callback when complete
 *
 * @example
 * {
 *   context: 'irc',
 *   '@type': 'leave',
 *   actor: {
 *     '@id': 'irc://slvrbckt@irc.freenode.net',
 *     '@type': 'person',
 *     displayName: 'slvrbckt'
 *   },
 *   target: {
 *     '@id': 'irc://irc.freenode.net/remotestorage',
 *     '@type': 'room',
 *     displayName: '#remotestorage'
 *   },
 *   object: {}
 * }
 *
 */
IRC.prototype.leave = function (job, done) {
  var self = this;

  self.session.debug('leave() called');

  self.session.client.get(job.actor['@id'], createObj, function (err, client) {
    if (err) { return done(err); }
    // leave channel
    self.session.debug('leave: ' + job.actor.displayName + ' -< ' + job.target.displayName);
    client.connection.irc.raw(['PART', job.target.displayName]);
    self._left(job.target.displayName);
    done();
  });
};

/**
 * Function: send
 *
 * Send a message to a room or private conversation.
 *
 * @param {object} - Activity streams job object
 * @param {object} - callback when complete
 *
 * @example
 * 
 *  {
 *    context: 'irc',
 *    '@type': 'send',
 *    actor: {
 *      '@id': 'irc://slvrbckt@irc.freenode.net',
 *      '@type': 'person',
 *      displayName: 'Nick Jennings',
 *      userName: 'slvrbckt'
 *    },
 *    target: {
 *      '@id': 'irc://irc.freenode.net/remotestorage',
 *      '@type': 'room',
 *      displayName: '#remotestorage'
 *    },
 *    object: {
 *      '@type': 'message',
 *      content: 'Hello from Sockethub!'
 *    }
 *  }
 *
 */
IRC.prototype.send = function (job, done) {
  var self = this;

  self.session.debug('send() called for ' + job.actor['@id'] + ' target: ' + job.target.id);

  self.session.client.get(job.actor['@id'], createObj, function (err, client) {
    if (err) { return done(err); }
    self.session.debug('send(): got client object');
    if (self._isJoined(job.target.displayName)) {
      var msg = job.object.content.replace(/^\s+|\s+$/g, "");
      self.session.debug('irc.say: ' + job.target.displayName + ', [' + msg + ']');
      //client.connection.irc.raw(['PRIVMSG', job.target.displayName, '' + msg]);
      client.connection.irc.privmsg(job.target.displayName, msg, true); //forcePushback
      done();
    } else {
      done("cannot send message to a channel of which you've not first `join`ed.");
    }
  });
};

/**
 * Function: update
 *
 * Indicate a change (ie. room topic update, or nickname change).
 *
 * @param {object} - Activity streams job object
 * @param {object} - callback when complete
 *
 * @example change topic
 *
 * {
 *   context: 'irc',
 *   '@type': 'update',
 *   actor: {
 *     '@id': 'irc://slvrbckt@irc.freenode.net',
 *     '@type': 'person',
 *     displayName: 'Nick Jennings',
 *     userName: 'slvrbckt'
 *   },
 *   target: {
 *     '@id': 'irc://irc.freenode.net/sockethub',
 *     '@type': 'room',
 *     displayName: '#sockethub'
 *   },
 *   object: {
 *     '@type': 'topic',
 *     topic: 'New version of Socekthub released!'
 *   }
 * }
 *
 * @example change nickname  
 * // TODO review, also when we rename a user, their person
 * //      object needs to change (and their credentials)
 * 
 *  {
 *    '@id': 1234,
 *    context: 'irc',
 *    '@type': 'udpate',
 *    actor: {
 *      '@id': 'irc://slvrbckt@irc.freenode.net',
 *      '@type': 'person',
 *      displayName: 'Nick Jennings',
 *      userName: 'slvrbckt'
 *    },
 *    object: {
 *      '@type': 'displayName'
 *    },
 *    target: {
 *      '@type': "person",
 *      displayName: 'CoolDude'
 *    }
 *  }
 */
IRC.prototype.update = function (job, done) {
  var self = this;

  self.session.debug('update() called for ' + job.actor.displayName);

  self.session.client.get(job.actor['@id'], createObj, function (err, client) {
    if (err) { return done(err); }
    self.session.debug('update(): got client object');

    if (job.target['@type'] === 'person') {
      self.session.debug('changing nick from ' + job.actor.displayName + ' to ' + job.target.displayName);
      // send nick change command
      client.connection.irc.raw(['NICK', job.target.displayName]);

      // preserve old creds
      var oldCreds = client.credentials; //JSON.parse(JSON.stringify(client.credentials));
      var newCreds = JSON.parse(JSON.stringify(client.credentials));

      // set new credentials
      newCreds.object.nick       = job.target.displayName;
      newCreds.actor.displayName = job.target.displayName;
      newCreds.actor['@id']          = job.target.id;

      self.session.store.save(job.target.id, newCreds, function (err) {
        if (err) {
          return done(err);
        }

        // reset index of client object in connection manager
        self.session.client.move(job.actor['@id'],
                                 oldCreds,
                                 job.target.id,
                                 newCreds);
        return done();
      });

    } else if (job.object['@type'] === 'topic') {
      // update topic
      self.session.debug('changing topic in channel ' + job.target.displayName);
      client.connection.irc.raw(['topic', job.target.displayName, job.object.topic]);
      return done();
    }
    done('unknown update action');
  });

};

/**
 * Function: observe
 *
 * Indicate an intent to observe something (ie. get a list of users in a room).
 *
 * @param {object} - Activity streams job object
 * @param {object} - callback when complete
 *
 * @example
 *
 *  {
 *    context: 'irc',
 *    '@type': 'observe',
 *    actor: {
 *      '@id': 'irc://slvrbckt@irc.freenode.net',
 *      '@type': 'person',
 *      displayName: 'Nick Jennings',
 *      userName: 'slvrbckt'
 *    },
 *    target: {
 *      '@id': 'irc://irc.freenode.net/sockethub',
 *      '@type': 'room',
 *      displayName: '#sockethub'
 *    },
 *    object: {
 *      '@type': 'attendance'
 *    }
 *  }
 *
 *  
 *  // The obove object might return:
 *  {
 *    context: 'irc',
 *    '@type': 'observe',
 *    actor: {
 *      '@id': 'irc://irc.freenode.net/sockethub',
 *      '@type': 'room',
 *      displayName: '#sockethub'
 *    },
 *    target: {},
 *    object: {
 *      '@type': 'attendance'
 *      members: [
 *        'RyanGosling',
 *        'PeeWeeHerman',
 *        'Commando',
 *        'Smoochie',
 *        'neo'
 *      ]
 *    }
 *  }
 *
 */
IRC.prototype.observe = function (job, done) {
  var self = this;

  self.session.debug('observe() called for ' + job.actor['@id']);

  self.session.client.get(job.actor['@id'], createObj, function (err, client) {
    if (err) { return done(err); }
    self.session.debug('observe(): got client object');
    if (job.object['@type'] === 'attendance') {
      self.session.debug('objserve() - sending NAMES for ' + job.target.displayName);
      client.connection.irc.raw(['NAMES', job.target.displayName]);
      done();
    } else {
      done("unknown '@type' '" + job.object['@type'] + "'");
    }
  });

};


IRC.prototype.cleanup = function (done) {
  this._channels = [];
  done();
  // var self = this;
  // self.session.client.get(job.actor['@id'], createObj, function (err, client) {
  //   if (err) { return done(err); }
  //   client.scope.debug('cleanup(): got client object');
  //   client.connection.irc.disconnect();
  //   done();
  // });
};

IRC.prototype._isJoined = function (channel) {
  if (channel.indexOf('#') === 0) {
    // valid channel name
    if (this._channels.indexOf(channel) >= 0) {
      return true;
    } else {
      return false;
    }
  } else {
    // usernames are always OK to send to
    return true;
  }
};

IRC.prototype._joined = function (channel) {
  // keep track of channels joined
  if (this._channels.indexOf(channel) < 0) {
    this._channels.push(channel);
  }
};

IRC.prototype._left = function (channel) {
  // keep track of channels left
  var index = this._channels.indexOf(channel);

  if (index >= 0) {
    this._channels.splice(index, 1);
  }
};


module.exports = IRC;
