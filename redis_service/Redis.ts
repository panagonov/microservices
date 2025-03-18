import * as uuid from "uuid";
import * as redis from "redis";

class RedisDB {
    client;
    publisher;
    subscriber;
    events = {};
    statuses = {
        running: "running",
        run: "run",
        processing : "processing",
        stopping : "stopping",
        stopped : "stopped"
    };
    status;

    constructor() {
        this.status = this.statuses.running;
        return this;
    }

    async init(settings) {
        return new Promise(resolve => {
            const url = `${settings.protocol ? settings.protocol : ""}${settings.user && settings.password ? `${settings.user}@${settings.password}.` : ""}${settings.host}${settings.port ? `:${settings.port}` : ""}`;
            this.client = redis.createClient({ url: url})

            this.client.on('ready', () => {
                console.log("- Redis client connected")
                this.status = this.statuses.run;
                resolve(this)
            });

            this.client.on('error', () => {
                this.status = this.statuses.running;
                console.log("Try to connect Redis Client")
            });

            this.client.connect();
        })
    }

    async waitToIdleState(){
        return new Promise((resolve: any) => {
            const interval = setInterval(() => {
                if(this.status === this.statuses.run) {
                    clearInterval(interval);
                    resolve()
                }
            }, 100)
        })
    }

    async quit() {
        if (this.status === this.statuses.stopping)
            return;
        await this.waitToIdleState();
        this.status = this.statuses.stopping;
        await this.client.quit();
        this.status =  this.statuses.stopped;
    }

    async create(_id, data, expire?) {
        let dataToSave;
        try {
            dataToSave = JSON.stringify(data)
        }
        catch(e){
            dataToSave = data
        }
        const id = _id || uuid.v4();

        await this.client.set(id, dataToSave);

        if(expire)
            await this.client.expire(id, expire)
        return id
    }

    async read(_id) {
        const data = await this.client.get(_id);

        let result;
        try {
            result = JSON.parse(data)
        }
        catch(e){
            result = data
        }
        return result;
    }

    async update(_id, data) {
        let result;
        try {
            result = JSON.stringify(data)
        }
        catch(e){
            result = data
        }
        return await this.client.set(_id, result);
    }

    async remove(_id) {
        return await this.client.del(_id);
    }
}

export default RedisDB
