import dotenv from "dotenv"
import PubSub from "../redis_service/PubSub";
import WorkerQueue from "../redis_service/WorkerQueue";
import FileManager, {EManagerType} from "./app";
import statuses from "./microserviceStatuses.json";

dotenv.config({path: `${__dirname}/../.env`})

const name = "File manager microservice"
const outputName = "file-manager"

enum Actions  {
    write = "write",
    read = "read",
    remove = "remove",
    exists = "exists",
}

interface ITaskData {
    input_channel: string
    output_channel?: string
    payload: {
        user: {id: string},
        data: {
            test?: boolean,
            filename: string,
            type: any,
            mimetype: string,
            content: string,
            meta: any,
            action: Actions,
            fileManagerSettings: {
                type: EManagerType
                path: string
                user?:string
                pass?:string
                region?: string
            }
        }
    }
}



let status = statuses.stop;


const attachExitEvent = (workerQueue, pubSub) => {
    function exitHandler(options, exitCode) {
        if (status === statuses.stopping)
            return;

        if (exitCode || exitCode === 0)
            console.log(`Stopping ${name}...`);

        let interval = setInterval(() => {
            if (status === "idle" && options.exit) {
                status = statuses.stopping
                clearInterval(interval)
                workerQueue.quit();
                pubSub.quit();
                console.log(`${name} was stopped!`);
                status = statuses.stop
                process.exit()
            }
        }, 5)
    }

    process.on('SIGINT', exitHandler.bind(null, {exit:true}));
    process.on('SIGUSR1', exitHandler.bind(null, {exit:true}));
    process.on('SIGUSR2', exitHandler.bind(null, {exit:true}));
}

const run = async () => {
    if (status !== statuses.stop)
        return console.error(`${name} is already started`);

    status = statuses.running;
    // initErrorHandling({mode: process.env.NODE_ENV, dsn: process.env.SENTRY_DSN, serverName: `${name}` });
    const pubSub = new PubSub()
    await pubSub.init({protocol: process.env.REDIS_PROTOCOL, host: process.env.REDIS_HOST, port: parseInt( process.env.REDIS_PORT)})
    const workerQueue = new WorkerQueue()
    await workerQueue.init({protocol: process.env.REDIS_PROTOCOL, host: process.env.REDIS_HOST, port: parseInt( process.env.REDIS_PORT)})

    console.log("channel", process.env.FILE_MANAGER_CHANNEL)
    workerQueue.subscribe(process.env.FILE_MANAGER_CHANNEL, async (inputData: {_id: string, taskData: ITaskData}, readyCb) => {
        const {_id, taskData} = inputData;
        console.log(`${name} received task`, _id)
        status = statuses.processing;
        const {input_channel, output_channel, payload} = taskData;
        const {user, data} = payload
        const action = data.action;
        let outputData;
        console.log({action, settings: data.fileManagerSettings})

        if (data.test) {
            outputData = {_id: _id, test: true, success: true}
            output_channel ? await pubSub.fire(output_channel, {user, data : outputData, type: outputName, send_to_himself: true}) : null
        }
        else {
            outputData = {
                _id: _id,
                name: data.filename,
                type:data.type,
                contentType: data.mimetype
            }

            try {
                const fileManager = new FileManager(data.fileManagerSettings);
                if (action === Actions.write) {
                    console.log(data.filename)
                    const isBase64 = data.content.length % 4 == 0 && /^[A-Za-z0-9+/]+[=]{0,2}$/.test(data.content);
                    const res = await fileManager.writeFile({
                        name   : data.filename,
                        content: Buffer.from(data.content, isBase64 ? "base64" : "utf8"),
                        content_type: data.mimetype,
                        meta: Object.assign(
                            {
                                user: user.id || ""
                            }, 
                            data.meta || {}
                        )
                    });
                    if(res?.error) {
                        console.error(res)
                        outputData = {_id: _id, error: res.error, message: res.message}
                        output_channel ?await pubSub.fire(output_channel, {user, data : outputData, type: outputName, ids: [user.id], send_to_himself: true}) : null
                    }
                    else {
                        output_channel ? await pubSub.fire(output_channel, {user, data : outputData, type: outputName, ids: [user.id], send_to_himself: true}) : null
                    }
                }
                else if (action === Actions.read) {
                    console.log("filename:", data.filename)
                    let file: any = null
                    try {
                        file = await fileManager.readFile(data.filename)
                    }
                    catch(e) {
                        console.error("READ error", e)
                        file = {error: e}
                    }
                    if(file?.error) {
                        console.error(file)
                        outputData = {_id: _id, error: file.error, message: file.message}
                        output_channel ? await pubSub.fire(output_channel, {user, data : outputData, type: outputName, ids: [user.id], send_to_himself: true}) : null
                    } else {
                        file.content = file.content.toString("base64")
                        output_channel ? await pubSub.fire(output_channel, {user, data : {_id: _id, file}, type: outputName, ids: [user.id], send_to_himself: true}) : null
                    }
                }
                else if (action === Actions.remove) {
                    const res = await fileManager.removeFile(data.filename)
                    if(res?.error) {
                        console.error(res)
                        outputData = {_id: _id, error: res.error, message: res.message}
                        output_channel ?await pubSub.fire(output_channel, {user, data : outputData, type: outputName, ids: [user.id], send_to_himself: true}) : null
                    }
                    else {
                        output_channel ? await pubSub.fire(output_channel, {user, data : {_id: _id, success: true}, type: outputName, ids: [user.id], send_to_himself: true}) : null
                    }
                }
                else if (action === Actions.exists) {
                    const exists = await fileManager.exists(data.filename)
                    if(exists?.error) {
                        console.error(exists)
                        outputData = {_id: _id, error: exists.error, message: exists.message}
                        output_channel ? await pubSub.fire(output_channel, {user, data : outputData, type: outputName, send_to_himself: true}) : null
                    }
                    else {
                        output_channel ? await pubSub.fire(output_channel, {user, data : {_id: _id, exists: exists}, type: outputName, ids: [user.id], send_to_himself: true}) : null
                    }
                }
            }
            catch(e) {
                console.error(e)
                outputData = {_id: _id, error: e}
                output_channel ? await pubSub.fire(output_channel, {user, data : outputData, type: outputName, ids: [user.id], send_to_himself: true}) : null
            }
        }

        readyCb()
        status =  statuses.idle;

        console.log(`${name} finished task`, _id)
    })

    attachExitEvent(workerQueue, pubSub);

    status = statuses.idle
    console.log(`${name} was started`);

    process.stdin.on("data", () => {});//so the program will not close instantly
}

run().catch(console.error);
