const debug = require('debug')('@dwebjs/network')
const url = require('url')
const https = require('https')
const Emitter = require('events')
const { stringify } = require('querystring')
const memoryCache = require('./cache')
const callMeMaybe = require('call-me-maybe')
const concat = require('concat-stream')

const DWEB_HASH_REGEX = /^[0-9a-f]{64}?$/i
const DWEB_PROTOCOL_REGEX = /^dweb:\/\/([0-9a-f]{64})/i
const DWEB_RECORD_NAME = 'dweb'
const DWEB_TXT_REGEX = /"?dwebkey=([0-9a-f]{64})"?/i
const VERSION_REGEX = /(\+[^\/]+)$/
const DEFAULT_DWEB_DNS_TTL = 3600 // 1hr
const MAX_DWEB_DNS_TTL = 3600 * 24 * 7 // 1 week
const DEFAULT_DNS_PROVIDERS = [
    ['cloudflare-dns.com', 443, '/dns-query'],
    ['dns.google', 443, '/resolve'],
    ['dns.quad9.net', 5053, '/dns-query']
]

// helper to support node6
function _asyncToGenerator(fn) {
    return function() {
        var gen = fn.apply(this, arguments);
        return new Promise(function(resolve, reject) {
            function step(key, arg) { try { var info = gen[key](arg); var value = info.value } catch (error) { reject(error); return } if (info.done) { resolve(value) } else { return Promise.resolve(value).then(function(value) { step('next', value) }, function(err) { step('throw', err) }) } }
            return step('next')
        })
    }
}

// helper to call promise-generating function
function maybe(cb, p) {
    if (typeof p === 'function') {
        p = p()
    }
    return callMeMaybe(cb, p)
}

module.exports = function(dwebDnsOpts) {
    dwebDnsOpts = dwebDnsOpts || {}
    if (dwebDnsOpts.hashRegex && !(dwebDnsOpts.hashRegex instanceof RegExp)) { throw new Error('opts.hashRegex must be a RegExp object') }
    if (dwebDnsOpts.txtRegex && !(dwebDnsOpts.txtRegex instanceof RegExp)) { throw new Error('opts.txtRegex must be a RegExp object') }
    if (dwebDnsOpts.protocolRegex && !(dwebDnsOpts.protocolRegex instanceof RegExp)) { throw new Error('opts.protocolRegex must be a RegExp object') }
    var hashRegex = dwebDnsOpts.hashRegex || DWEB_HASH_REGEX
    var dnsTxtRegex = dwebDnsOpts.txtRegex || DWEB_TXT_REGEX
    var protocolRegex = dwebDnsOpts.protocolRegex || DWEB_PROTOCOL_REGEX
    var recordName = dwebDnsOpts.recordName || DWEB_RECORD_NAME
    var pCache = dwebDnsOpts.persistentCache
    var mCache = memoryCache()
    mCache.init({ ttl: 60 })
    var dnsHost
    var dnsPort
    var dnsPath
    if (!dwebDnsOpts.dnsHost || !dwebDnsOpts.dnsPath) {
        let dnsProvider = DEFAULT_DNS_PROVIDERS[Math.floor(Math.random() * DEFAULT_DNS_PROVIDERS.length)]
        dnsHost = dnsProvider[0]
        dnsPort = dnsProvider[1]
        dnsPath = dnsProvider[2]
    } else {
        dnsHost = dwebDnsOpts.dnsHost
        dnsPort = dwebDnsOpts.dnsPort || 443
        dnsPath = dwebDnsOpts.dnsPath
    }

    var dwebDns = new Emitter()

    function resolveName(name, opts, cb) {
        if (typeof opts === 'function') {
            cb = opts
            opts = null
        }
        var ignoreCache = opts && opts.ignoreCache
        var ignoreCachedMiss = opts && opts.ignoreCachedMiss
        var noDnsOverHttps = opts && opts.noDnsOverHttps
        var noWellKnownDWeb = opts && opts.noWellKnownDWeb
        return maybe(cb, _asyncToGenerator(function*() {
            // parse the name as needed
            var nameParsed = url.parse(name)
            name = nameParsed.hostname || nameParsed.pathname

            // strip the version
            name = name.replace(VERSION_REGEX, '')

            // is it a hash?
            if (hashRegex.test(name)) {
                return name.slice(0, 64)
            }

            try {
                // check the cache
                if (!ignoreCache) {
                    const cachedKey = mCache.get(name)
                    if (typeof cachedKey !== 'undefined') {
                        if (cachedKey || (!cachedKey && !ignoreCachedMiss)) {
                            debug('In-memory cache hit for name', name, cachedKey)
                            if (cachedKey) return cachedKey
                            else throw new Error('DNS record not found') // cached miss
                        }
                    }
                }

                var res
                if (!noDnsOverHttps) {
                    try {
                        // do a DNS-over-HTTPS lookup
                        res = yield fetchDnsOverHttpsRecord(dwebDns, name, { host: dnsHost, port: dnsPort, path: dnsPath })

                        // parse the record
                        res = parseDnsOverHttpsRecord(dwebDns, name, res.body, dnsTxtRegex)
                        dwebDns.emit('resolved', {
                            method: 'dns-over-https',
                            name,
                            key: res.key
                        })
                        debug('dns-over-http resolved', name, 'to', res.key)
                    } catch (e) {
                        // ignore, we'll try .well-known/`${recordName}` next
                        res = false
                    }
                }

                if (!res && !noWellKnownDWeb) {
                    // do a .well-known/`${recordName}` lookup
                    res = yield fetchWellKnownRecord(name, recordName)
                    if (res.statusCode === 0 || res.statusCode === 404) {
                        debug('.well-known/' + recordName + ' lookup failed for name:', name, res.statusCode, res.err)
                        dwebDns.emit('failed', {
                            method: 'well-known',
                            name,
                            err: 'HTTP code ' + res.statusCode + ' ' + res.err
                        })
                        mCache.set(name, false, 60) // cache the miss for a minute
                        throw new Error('DNS record not found')
                    } else if (res.statusCode !== 200) {
                        debug('.well-known/' + recordName + ' lookup failed for name:', name, res.statusCode)
                        dwebDns.emit('failed', {
                            method: 'well-known',
                            name,
                            err: 'HTTP code ' + res.statusCode
                        })
                        throw new Error('DNS record not found')
                    }

                    // parse the record
                    res = parseWellKnownDWebRecord(dwebDns, name, res.body, protocolRegex, recordName)
                    dwebDns.emit('resolved', {
                        method: 'well-known',
                        name,
                        key: res.key
                    })
                    debug('.well-known/' + recordName + ' resolved', name, 'to', res.key)
                }

                // cache
                if (res.ttl !== 0) mCache.set(name, res.key, res.ttl)
                if (pCache) pCache.write(name, res.key, res.ttl)

                return res.key
            } catch (err) {
                if (pCache) {
                    // read from persistent cache on failure
                    return pCache.read(name, err)
                }
                throw err
            }
        }))
    }

    function listCache() {
        return mCache.list()
    }

    function flushCache() {
        dwebDns.emit('cache-flushed')
        mCache.flush()
    }

    dwebDns.resolveName = resolveName
    dwebDns.listCache = listCache
    dwebDns.flushCache = flushCache
    return dwebDns
}

function fetchDnsOverHttpsRecord(dwebDns, name, { host, port, path }) {
    return new Promise((resolve, reject) => {
        // ensure the name is a FQDN
        if (!name.includes('.')) {
            debug('dns-over-https failed', name, 'Not an a FQDN')
            dwebDns.emit('failed', {
                method: 'dns-over-https',
                name,
                err: 'Name is not a FQDN'
            })
            reject(new Error('Domain is not a FQDN.'))
        } else if (!name.endsWith('.')) {
            name = name + '.'
        }
        var query = {
            name,
            type: 'TXT'
        }
        debug('dns-over-https lookup for name:', name)
        https.get({
            host,
            port,
            path: `${path}?${stringify(query)}`,
            // Cloudflare requires this exact header; luckily everyone else ignores it
            headers: {
                'Accept': 'application/dns-json'
            },
            timeout: 2000
        }, function(res) {
            res.setEncoding('utf-8')
            res.pipe(concat(body => resolve({ statusCode: res.statusCode, body })))
        }).on('error', function(err) {
            resolve({ statusCode: 0, err, body: '' })
        })
    })
}

function parseDnsOverHttpsRecord(dwebDns, name, body, dnsTxtRegex) {
    // decode to obj
    var record
    try {
        record = JSON.parse(body)
    } catch (e) {
        debug('dns-over-https failed', name, 'did not give a valid JSON response')
        dwebDns.emit('failed', {
            method: 'dns-over-https',
            name,
            err: 'Failed to parse JSON response'
        })
        throw new Error('Invalid dns-over-https record, must provide json')
    }

    // find valid answers
    var answers = record['Answer']
    if (!answers || !Array.isArray(answers)) {
        debug('dns-over-https failed', name, 'did not give any TXT answers')
        dwebDns.emit('failed', {
            method: 'dns-over-https',
            name,
            err: 'Did not give any TXT answers'
        })
        throw new Error('Invalid dns-over-https record, no TXT answers given')
    }
    answers = answers.filter(a => {
        if (!a || typeof a !== 'object') {
            return false
        }
        if (typeof a.data !== 'string') {
            return false
        }
        var match = dnsTxtRegex.exec(a.data)
        if (!match) {
            return false
        }
        a.key = match[1]
        return true
    })
    if (!answers[0]) {
        debug('dns-over-https failed', name, 'did not give any TXT answers')
        dwebDns.emit('failed', {
            method: 'dns-over-https',
            name,
            err: 'Did not give any TXT answers'
        })
        throw new Error('Invalid dns-over-https record, no TXT answer given')
    }

    // put together res
    var res = { key: answers[0].key, ttl: answers[0].TTL }
    if (!Number.isSafeInteger(res.ttl) || res.ttl < 0) {
        res.ttl = DEFAULT_DWEB_DNS_TTL
    }
    if (res.ttl > MAX_DWEB_DNS_TTL) {
        res.ttl = MAX_DWEB_DNS_TTL
    }
    return res
}

function fetchWellKnownRecord(name, recordName) {
    return new Promise((resolve, reject) => {
        debug('.well-known/dweb lookup for name:', name)
        https.get({
            host: name,
            path: '/.well-known/' + recordName,
            timeout: 2000
        }, function(res) {
            res.setEncoding('utf-8')
            res.pipe(concat(body => resolve({ statusCode: res.statusCode, body })))
        }).on('error', function(err) {
            resolve({ statusCode: 0, err, body: '' })
        })
    })
}

function parseWellKnownDWebRecord(dwebDns, name, body, protocolRegex, recordName) {
    if (!body || typeof body !== 'string') {
        dwebDns.emit('failed', {
            method: 'well-known',
            name,
            err: 'Empty response'
        })
        throw new Error('DNS record not found')
    }

    const lines = body.split('\n')
    var key, ttl

    // parse url
    try {
        key = protocolRegex.exec(lines[0])[1]
    } catch (e) {
        debug('.well-known/' + recordName + ' failed', name, 'must conform to ' + protocolRegex)
        dwebDns.emit('failed', {
            method: 'well-known',
            name,
            err: 'Record did not conform to ' + protocolRegex
        })
        throw new Error('Invalid .well-known/' + recordName + ' record, must conform to' + protocolRegex)
    }

    // parse ttl
    try {
        if (lines[1]) {
            ttl = +(/^ttl=(\d+)$/i.exec(lines[1])[1])
        }
    } catch (e) {
        dwebDns.emit('failed', {
            method: 'well-known',
            name,
            err: 'Failed to parse TTL line, error: ' + e.toString()
        })
        debug('.well-known/' + recordName + ' failed to parse TTL for %s, line: %s, error:', name, lines[1], e)
    }
    if (!Number.isSafeInteger(ttl) || ttl < 0) {
        ttl = DEFAULT_DWEB_DNS_TTL
    }
    if (ttl > MAX_DWEB_DNS_TTL) {
        ttl = MAX_DWEB_DNS_TTL
    }

    return { key, ttl }
}