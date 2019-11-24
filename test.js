var tape = require('tape')
var dwebDns = require('./index')()
var dmemoDns = require('./index')({
    hashRegex: /^[0-9a-f]{64}?$/i,
    recordName: 'dmemo',
    protocolRegex: /^dmemo:\/\/([0-9a-f]{64})/i,
    txtRegex: /^"?dmemokey=([0-9a-f]{64})"?$/i
})

var FAKE_DWEB = 'f'.repeat(64)

tape('Successful test against cblgh.org', function(t) {
    dmemoDns.resolveName('cblgh.org', function(err, name) {
        t.error(err)
        t.ok(/[0-9a-f]{64}/.test(name))

        dmemoDns.resolveName('cblgh.org').then(function(name2) {
            t.equal(name, name2)
            t.end()
        })
    })
})

tape('Works for keys', function(t) {
    dmemoDns.resolveName('14bc77d788fdaf07b89b28e9d276e47f2e44011f4adb981921056e1b3b40e99e', function(err, name) {
        t.error(err)
        t.equal(name, '14bc77d788fdaf07b89b28e9d276e47f2e44011f4adb981921056e1b3b40e99e')
        t.end()
    })
})

tape('Successful test against dwebs.io', function(t) {
    dwebDns.resolveName('dwebs.io', function(err, name) {
        t.error(err)
        t.ok(/[0-9a-f]{64}/.test(name))

        dwebDns.resolveName('dwebs.io').then(function(name2) {
            t.equal(name, name2)
            t.end()
        })
    })
})

tape('Works for keys', function(t) {
    dwebDns.resolveName('40a7f6b6147ae695bcbcff432f684c7bb5291ea339c28c1755896cdeb80bd2f9', function(err, name) {
        t.error(err)
        t.equal(name, '40a7f6b6147ae695bcbcff432f684c7bb5291ea339c28c1755896cdeb80bd2f9')
        t.end()
    })
})

tape('Works for versioned keys and URLs', function(t) {
    dwebDns.resolveName('40a7f6b6147ae695bcbcff432f684c7bb5291ea339c28c1755896cdeb80bd2f9+5', function(err, name) {
        t.error(err)
        t.equal(name, '40a7f6b6147ae695bcbcff432f684c7bb5291ea339c28c1755896cdeb80bd2f9')

        dwebDns.resolveName('dwebs.io+5', function(err, name) {
            t.error(err)
            t.ok(/[0-9a-f]{64}/.test(name))
            t.end()
        })
    })
})

tape('Works for non-numeric versioned keys and URLs', function(t) {
    dwebDns.resolveName('40a7f6b6147ae695bcbcff432f684c7bb5291ea339c28c1755896cdeb80bd2f9+foo', function(err, name) {
        t.error(err)
        t.equal(name, '40a7f6b6147ae695bcbcff432f684c7bb5291ea339c28c1755896cdeb80bd2f9')

        dwebDns.resolveName('dwebs.io+foo', function(err, name) {
            t.error(err)
            t.ok(/[0-9a-f]{64}/.test(name))
            t.end()
        })
    })
})

tape('Works for full URLs', function(t) {
    dwebDns.resolveName('dweb://40a7f6b6147ae695bcbcff432f684c7bb5291ea339c28c1755896cdeb80bd2f9', function(err, name) {
        t.error(err)
        t.ok(/[0-9a-f]{64}/.test(name))

        dwebDns.resolveName('dweb://dwebs.io/foo.txt?bar=baz', function(err, name) {
            t.error(err)
            t.ok(/[0-9a-f]{64}/.test(name))
            t.end()
        })
    })
})

tape('A bad hostname fails gracefully', function(t) {
    dwebDns.resolveName('example.com', { ignoreCache: true }, function(err, name) {
        t.ok(err)
        t.notOk(name)

        dwebDns.resolveName(1234, function(err, name) {
            t.ok(err)
            t.notOk(name)

            dwebDns.resolveName('foo bar', { ignoreCache: true }, function(err, name) {
                t.ok(err)
                t.notOk(name)

                t.end()
            })
        })
    })
})

tape('A bad DNS record fails gracefully', function(t) {
    dwebDns.resolveName('bad-dweb-record1.dbrowser.io', { ignoreCache: true }, function(err, name) {
        t.ok(err)
        t.notOk(name)
        t.end()
    })
})

tape('Unqualified domain fails gracefully', function(t) {
    dwebDns.resolveName('bad-dweb-domain-name', { ignoreCache: true }, function(err, name) {
        t.ok(err)
        t.notOk(name)
        t.end()
    })
})

tape('Successful test against dbrowser.io', function(t) {
    dwebDns.resolveName('dbrowser.io', { ignoreCache: true }, function(err, name) {
        t.error(err)
        t.ok(/[0-9a-f]{64}/.test(name))

        dwebDns.resolveName('dbrowser.io').then(function(name2) {
            t.equal(name, name2)
            t.end()
        }).catch(function(err) {
            t.error(err)
            t.end()
        })
    })
})

tape('Successful test against dbrowser.io (no dns-over-https)', function(t) {
    dwebDns.resolveName('dbrowser.io', { noDnsOverHttps: true, ignoreCache: true }, function(err, name) {
        t.error(err)
        t.ok(/[0-9a-f]{64}/.test(name))

        dwebDns.resolveName('dbrowser.io').then(function(name2) {
            t.equal(name, name2)
            t.end()
        }).catch(function(err) {
            t.error(err)
            t.end()
        })
    })
})

tape('Successful test against dbrowser.io (no well-known/dweb)', function(t) {
    dwebDns.resolveName('dbrowser.io', { noWellknownDWeb: true, ignoreCache: true }, function(err, name) {
        t.error(err)
        t.ok(/[0-9a-f]{64}/.test(name))

        dwebDns.resolveName('dbrowser.io').then(function(name2) {
            t.equal(name, name2)
            t.end()
        }).catch(function(err) {
            t.error(err)
            t.end()
        })
    })
})

tape('List cache', function(t) {
    t.is(Object.keys(dwebDns.listCache()).length, 6)
    t.end()
})

tape('Persistent fallback cache', function(t) {
    t.plan(8)

    var persistentCache = {
        read: function(name, err) {
            if (name === 'foo') return '40a7f6b6147ae695bcbcff432f684c7bb5291ea339c28c1755896cdeb80bd2f9'
            throw err
        },
        write: function(name, key, ttl) {
            t.deepEqual(name, 'dwebs.io')
            t.ok(/[0-9a-f]{64}/.test(key))
        }
    }

    var dwebDns = require('./index')({ persistentCache })

    dwebDns.resolveName('dwebs.io', function(err, key) {
        t.error(err)
        t.ok(/[0-9a-f]{64}/.test(key))

        dwebDns.resolveName('foo', function(err, key) {
            t.error(err)
            t.deepEqual(key, '40a7f6b6147ae695bcbcff432f684c7bb5291ea339c28c1755896cdeb80bd2f9')

            dwebDns.resolveName('bar', function(err, key) {
                t.ok(err)
                t.notOk(key)

                t.end()
            })
        })
    })
})

tape('Persistent fallback cache doesnt override live results', function(t) {
    var persistentCache = {
        read: function(name, err) {
            if (name === 'dwebs.io') return 'from-cache'
            throw err
        },
        write: function(name, key, ttl) {}
    }

    var dwebDns = require('./index')({ persistentCache })

    dwebDns.resolveName('dwebs.io', function(err, key) {
        t.error(err)
        t.ok(/[0-9a-f]{64}/.test(key))
        t.end()
    })
})