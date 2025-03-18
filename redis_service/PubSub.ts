import RedisDb from "./Redis";

class PubSub extends RedisDb {
    constructor() {
        super()
    }

    async init(settings) {
        await super.init(settings);

        return new Promise(resolve => {
            // const url = `redis://${settings.user && settings.password ? `${settings.user}@${settings.password}.` : ""}${settings.host}:${settings.port}`
            this.publisher = this.client.duplicate();

            this.publisher.on('ready', () => {
                console.log("- Redis Publisher connected")
                this.status = this.statuses.run;
            });

            this.publisher.on('error', () => {
                this.status = this.statuses.running;
                console.log("Try to connect Redis Publisher");});

            this.publisher.connect();

            this.subscriber = this.client.duplicate();

            this.subscriber.on('ready', () => {
                console.log("- Redis Subscriber connected")
                this.status = this.statuses.run;
                resolve(this)
            });

            this.subscriber.on('error', () => {
                this.status = this.statuses.running;
                console.log("Try to connect Redis Subscriber");});

            this.subscriber.connect();
        })
    }

    on(channel, callback){
        this.subscriber.subscribe(channel, message => {
            let result;
            try {
                result = JSON.parse(message)
            }
            catch(e) {
                result = message
            }

            callback(result)
        })
    }

    async off(channel){
        await this.subscriber.unsubscribe(channel)
    }

    fire(channel, data){
        let message;
        try{
            message = JSON.stringify(data);
        }
        catch(e){
            message = data;
        }

        this.publisher.publish(channel, message)
    }
}

export default PubSub;
