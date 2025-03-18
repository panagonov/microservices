import RedisDb from "./Redis";

class WorkerQuery extends RedisDb {
    wqSubscribeDelay = 2000;
    constructor() {
        super()
    }

    async wait(delay){
        return new Promise(resolve => {
            setTimeout(resolve, delay)
        })
    }

    subscribe(channel, callback) {
        // const consume = () => {
        //     if (this.status !== this.statuses.stopping)
        //
        //     process.nextTick(consume)
        // }

        (async () => {
            while(true) {
                if(this.status === this.statuses.processing) {
                    await this.wait(500);
                }

                let task = await this.pop(channel, this.wqSubscribeDelay)
                if(task) {
                    const taskId = task.element
                    let taskData = await this.read(taskId);

                    if (taskData) {
                        this.status = this.statuses.processing;
                        let jsonData;
                        try {
                            jsonData = JSON.parse(taskData)
                        }
                        catch(e) {
                            jsonData = taskData;
                        }

                        callback({_id: taskId, taskData: jsonData}, async (response: any = {}) => {
                            if (!response.error)
                                await this.remove(taskId)

                            if (this.status === this.statuses.processing) {
                                this.status = this.statuses.run;
                            }
                        })
                    }
                }
            }

        })()
    }

    async push(channel, data){
        const id = await this.create(null, data);
        try{
            await this.client.lPush(channel, id);
        }
        catch(e){
            console.error(e)
        }

        return id;
    }

    async pop(channel, waiting){
        return await this.client.brPop(channel, waiting)
    }
    async count(channel){
        return await this.client.lLen(channel)
    }
}

export default WorkerQuery;
