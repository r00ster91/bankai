var Emitter = require('events').EventEmitter
var debug = require('debug')('bankai')
var graph = require('buffer-graph')
var assert = require('assert')
var path = require('path')
var pino = require('pino')

var localization = require('./localization')
var queue = require('./lib/queue')

var assetsNode = require('./lib/graph-assets')
var documentNode = require('./lib/graph-document')
var manifestNode = require('./lib/graph-manifest')
var scriptNode = require('./lib/graph-script')
var serviceWorkerNode = require('./lib/graph-service-worker')
var styleNode = require('./lib/graph-style')

module.exports = Bankai

function Bankai (entry, opts) {
  if (!(this instanceof Bankai)) return new Bankai(entry, opts)
  opts = opts || {}
  this.local = localization(opts.language || 'en-US')
  this.log = pino(opts.logStream || process.stdout)

  assert.equal(typeof entry, 'string', 'bankai: entry should be type string')
  assert.ok(/^\//.test(entry), 'bankai: entry should be an absolute path. Received: ' + entry)
  assert.equal(typeof opts, 'object', 'bankai: opts should be type object')

  var self = this
  var methods = [
    'manifest',
    'assets',
    'service-worker',
    'scripts',
    'style',
    'documents'
  ]

  // Initialize data structures.
  var key = Buffer.from('be intolerant of intolerance')
  this.queue = queue(methods)    // The queue caches requests until ready.
  this.graph = graph(key)        // The graph manages relations between deps.

  // Detect when we're ready to allow requests to go through.
  this.graph.on('change', function (nodeName, edgeName, state) {
    self.emit('change', nodeName, edgeName, state)
    var eventName = nodeName + ':' + edgeName
    if (eventName === 'assets:list') self.queue.assets.ready()
    else if (eventName === 'documents:list') self.queue.documents.ready()
    else if (eventName === 'manifest:bundle') self.queue.manifest.ready()
    else if (eventName === 'scripts:bundle') self.queue.scripts.ready()
    else if (eventName === 'service-worker:bundle') self.queue['service-worker'].ready()
    else if (eventName === 'style:bundle') self.queue.style.ready()
  })

  // Handle errors so they can be logged.
  this.graph.on('error', function (err) {
    self.emit('error', err)
  })

  // Insert nodes into the graph.
  this.graph.node('assets', assetsNode)
  // this.graph.node('document', [ 'manifest:color', 'style:bundle', 'assets:favicons', 'script:bundle' ], documentNode)
  this.graph.node('documents', [ 'manifest:color', 'style:bundle', 'scripts:bundle' ], documentNode)
  this.graph.node('manifest', manifestNode)
  this.graph.node('scripts', scriptNode)
  this.graph.node('service-worker', [ 'assets:list', 'style:bundle', 'scripts:bundle', 'documents:list' ], serviceWorkerNode)
  this.graph.node('style', [ 'scripts:style', 'scripts:bundle' ], styleNode)

  // Kick off the graph.
  this.graph.start({
    dirname: path.dirname(entry),
    assert: opts.assert !== false,
    watch: opts.watch !== false,
    fullPaths: opts.fullPaths,
    log: this.log,
    watchers: {},
    entry: entry,
    opts: opts
  })
}
Bankai.prototype = Object.create(Emitter.prototype)

Bankai.prototype.scripts = function (filename, cb) {
  assert.equal(typeof filename, 'string')
  assert.equal(typeof cb, 'function')
  var stepName = 'scripts'
  var edgeName = filename.split('.')[0]
  var self = this
  this.queue[stepName].add(function () {
    var data = self.graph.data[stepName][edgeName]
    if (!data) return cb(new Error('bankai.scripts: could not find a bundle for ' + filename))
    cb(null, data)
  })
}

Bankai.prototype.style = function (cb) {
  assert.equal(typeof cb, 'function')
  var stepName = 'style'
  var edgeName = 'bundle'
  var self = this
  this.queue[stepName].add(function () {
    var data = self.graph.data[stepName][edgeName]
    if (!data) return cb(new Error('bankai.style: could not find bundle'))
    cb(null, data)
  })
}

Bankai.prototype.documents = function (filename, cb) {
  assert.equal(typeof filename, 'string')
  assert.equal(typeof cb, 'function')
  if (filename === '/') filename = 'index'
  var stepName = 'documents'
  var edgeName = filename.split('.')[0] + '.html'
  var self = this
  this.queue[stepName].add(function () {
    var data = self.graph.data[stepName][edgeName]
    if (!data) return cb(new Error('bankai.document: could not find a document for ' + filename))
    cb(null, data)
  })
}

Bankai.prototype.manifest = function (cb) {
  assert.equal(typeof cb, 'function')
  var stepName = 'manifest'
  var edgeName = 'bundle'
  var self = this
  this.queue[stepName].add(function () {
    var data = self.graph.data[stepName][edgeName]
    if (!data) return cb(new Error('bankai.manifest: could not find bundle'))
    cb(null, data)
  })
}

Bankai.prototype.serviceWorker = function (cb) {
  assert.equal(typeof cb, 'function')
  var stepName = 'service-worker'
  var edgeName = 'bundle'
  var self = this
  this.queue[stepName].add(function () {
    var data = self.graph.data[stepName][edgeName]
    if (!data) return cb(new Error('bankai.serviceWorker: could not find bundle'))
    cb(null, data)
  })
}

Bankai.prototype.assets = function (edgeName, cb) {
  assert.equal(typeof edgeName, 'string')
  assert.equal(typeof cb, 'function')
  var stepName = 'assets'
  var self = this
  this.queue[stepName].add(function () {
    var data = self.graph.data[stepName][edgeName]
    if (!data) return cb(new Error('bankai.asset: could not find a file for ' + edgeName))
    cb(null, data)
  })
}

Bankai.prototype.close = function () {
  debug('closing all file watchers')
  this.graph.emit('close')
  this.emit('close')
}
