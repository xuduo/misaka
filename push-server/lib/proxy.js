module.exports = function (config, server) {
    return new Proxy(config, server);
}

class Proxy {

    constructor(config, server) {
        const instance = config.instance || 1;
        console.log("starting instance #" + instance);
        config.io_port = config.io_port + instance - 1;
        config.api_port = config.api_port + instance - 1;

        const cluster = require('./redis/simpleRedisHashCluster')(config.redis);

        this.io = require('socket.io')(server, {
            pingTimeout: config.pingTimeout,
            pingInterval: config.pingInterval,
            transports: ['websocket', 'polling']
        });
        server.listen(config.io_port);
        console.log("start server on port " + config.io_port);
        this.tagService = require('./service/tagService')(cluster);
        this.stats = require('./stats/stats')(cluster, config.io_port, config.statsCommitThreshold);
        const socketIoRedis = require('./redis/redisAdapter')({
            pubClient: cluster,
            subClient: cluster,
            key: 'io'
        }, null, this.stats);
        this.io.adapter(socketIoRedis);
        let packetService;
        if (config.redis.event) {
            packetService = require('./service/packetService')(cluster, cluster);
        }
        this.uidStore = require('./redis/uidStore')(cluster);
        this.ttlService = require('./service/ttlService')(this.io, cluster, config.ttl_protocol_version);
        const tokenTTL = config.tokenTTL || 1000 * 3600 * 24 * 30;
        this.notificationService = require('./service/notificationService')(config.apns, cluster, this.ttlService, tokenTTL);
        this.httpProxyService = require('./service/httpProxyService')(config.http_remove_headers);
        const proxyServer = require('./server/proxyServer')(this.io, this.stats, packetService, this.notificationService, this.uidStore, this.ttlService, this.httpProxyService, this.tagService);
        const apiThreshold = require('./api/apiThreshold')(cluster);
        const adminCommand = require('./server/adminCommand')(cluster, this.stats, packetService, proxyServer, apiThreshold);
        let topicOnline;
        if (config.topicOnlineFilter) {
            topicOnline = require('./stats/topicOnline')(cluster, this.io, this.stats.id, config.topicOnlineFilter);
        }
        const providerFactory = require('./service/notificationProviderFactory')();
        this.notificationService.providerFactory = providerFactory;
        if (config.apns != undefined) {
            this.apnService = require('./service/apnProvider')(config.apns, config.apnApiUrls, cluster, this.stats, tokenTTL);
            providerFactory.addProvider(this.apnService);
        }
        if (config.huawei) {
            this.huaweiProvider = require('./service/huaweiProvider')(config.huawei, this.stats);
            providerFactory.addProvider(this.huaweiProvider);
        }
        if (config.xiaomi) {
            this.xiaomiProvider = require('./service/xiaomiProvider')(config.xiaomi, this.stats);
            providerFactory.addProvider(this.xiaomiProvider);
        }
    }

    close() {
        this.io.close();
        if (this.restApi) {
            this.restApi.close();
        }
    }
}