import dotenv from "dotenv"
import { createReadStream, createWriteStream, readFileSync, unlinkSync, writeFileSync, existsSync, mkdirSync, statSync } from "fs";
import axios from "axios";
import mammoth from "mammoth";
import FormData from "form-data";
import PubSub from "../redis_service/PubSub";
import WorkerQueue from "../redis_service/WorkerQueue";
import statuses from "./microserviceStatuses.json";
import { PDFDocument } from 'pdf-lib';
import PDFDocumentKit from 'pdfkit';

const wait = (delay: number) =>
    new Promise(resolve =>
        setTimeout(resolve, delay)
    )


const tempDir = `${__dirname}/_upload/`
dotenv.config({ path: `${__dirname}/../.env` })

const instance = axios.create({
    maxContentLength: Infinity,
    maxBodyLength: Infinity
});

if (!existsSync(tempDir))
    mkdirSync(tempDir, { recursive: true })

enum Actions {
    optimizeImage = "optimizeImage",
    textract = "textract",
    preview = "preview",
    convert = "convert",
}

interface ITaskData {
    input_channel: string
    output_channel?: string
    payload: {
        user: { id: string },
        data: {
            test?: boolean,
            filename: string,
            type: string,
            mimetype: string,
            content: string,
            preview: any,
            convertType?: string
            textFormat?: "plain" | "html"
            sizes: any[],
            actions: Actions[],
            fileManagerSettings: {
                type: string
                path: string
                user?: string
                pass?: string
                region?: string
            }
        }
    }
}

const name = "File utils microservice";
const outputName = "image-optimizer"
const fileManagerCallbackChannel = "file-utils-file-manager"

let status = statuses.stop;

const extractTextFromPdfWithImages = async ({ file, fileContent, textFormat }, callback?: (data: any) => void): Promise<{ success: boolean, text?: string, error?: any }> => {
    const textResult = []
    const base64Content = typeof fileContent === "string" ? fileContent : fileContent.toString("base64")
    const pdfDoc = await PDFDocument.load(Buffer.from(base64Content, "base64"));
    const pageCount = pdfDoc.getPageCount();
    const pages = pdfDoc.getPages()
    console.log("Extract text from pdf with images. Number of pages:", pageCount)

    for (let i = 0; i < pageCount; i++) {
        callback?.({ status: "images_in_pdf", pages: pageCount, current: i })
        console.log(`Starting page: ${i + 1}`)
        console.time(`Finish: ${i + 1}/${pageCount}`)

        try {
            const pdfPage = pages[i];
            const pageWidth = pdfPage.getWidth();
            const pageHeight = pdfPage.getHeight();
            const res: any = await previewFile({ 
                file: Object.assign({}, {...file}), 
                fileContent, 
                options: { 
                    size: [pageWidth * 2, pageHeight * 2], 
                    page: i + 1, 
                    density: 600, 
                    quality: 100, 
                    hiRes: true 
                } })
            if (res.success && res.data) {
                const file = res.data
                file.originalname = file.filename + ".jpg"
                const pageRes = await extractText({ file: res.data, fileContent: res.data.content, textFormat })
                textResult.push(pageRes.text as string || "")
            }
        }
        catch (e) {
            console.error(e)
        }
        console.timeEnd(`Finish: ${i + 1}/${pageCount}`)
    }
    console.log(textResult)
    return { success: true, text: textResult.join(" ") }
}

const extractText = async ({ file, fileContent, textFormat }, callback?: (data: any) => void): Promise<{ success: boolean, text?: string, error?: any }> => {
    const base64Content = typeof fileContent === "string" ? fileContent : fileContent.toString("base64")
    const fileType = (file.originalname || "").split(".").pop()
    try {
        if (textFormat === "html") {
            if (["doc", "docx"].includes(fileType)) {
                try {
                    const result = await mammoth.convertToHtml({ buffer: Buffer.from(base64Content, "base64") })
                    console.log("ready", !!result?.value)
                    const resNoImages = result.value.replace(/<img[^>]*>/g, "")
                    return { success: true, text: resNoImages }
                }
                catch (e) {
                    console.log("doc text extraction failed", e)
                }
            }
            else if (fileType === "pdf") {
                let fileName = file.path.replace(/\\/g, "/").split("/").pop()
                let outputPath = tempDir + fileName;
                writeFileSync(outputPath, fileContent, "base64")
                try {
                    const form = new FormData();

                    form.append('file', createReadStream(outputPath));
                    console.log("send to flex markdown")
                    console.time("FDF_TO_MD")
                    const response = await instance.post(process.env.FLEX_MARKDOWN_URL + "/pdf_to_md", form, {
                        headers: {
                            Authorization: `Bearer ${process.env.FLEX_MARKDOWN_TOKEN}`
                        },
                        ...form.getHeaders()
                    })
                    console.timeEnd("FDF_TO_MD")
                    let text = ""
                    if (response.status === 200)
                        text = response.data
                    try {
                        unlinkSync(`${outputPath}.html`)
                    }
                    catch (e) { }
                    return { success: true, text: text }
                }
                catch (e) {
                    console.log("pdf text extraction failed", e)
                    try {
                        unlinkSync(`${outputPath}.html`)
                    }
                    catch (e) { }
                }
            }
            else if (["png", "jpg", "jpeg"].includes(fileType)) {
                let fileName = file.path.replace(/\\/g, "/").split("/").pop()
                let outputPath = tempDir + fileName;
                writeFileSync(outputPath, fileContent, "base64")
                try {

                    const form = new FormData();

                    form.append('files', createReadStream(outputPath));
                    const response = await instance.post(process.env.FLEX_MARKDOWN_URL + "/images_to_md_pdf", form, {
                        headers: {
                            Authorization: `Bearer ${process.env.FLEX_MARKDOWN_TOKEN}`
                        },
                        ...form.getHeaders()
                    })
                    let text = ""
                    if (response.status === 200)
                        text = response.data
                    try {
                        unlinkSync(`${outputPath}.html`)
                    }
                    catch (e) { }
                    return { success: true, text: text }
                }
                catch (e) {
                    console.log("image text extraction failed", e)
                    try {
                        unlinkSync(`${outputPath}.html`)
                    }
                    catch (e) { }
                }
            }
        }

        const result = await instance.post(process.env.TEXTRACT_URL, {
            data: base64Content,
            "file_type": fileType,
            encoding: null
        })
        if (result.status !== 200)
            return { success: false, error: result }
        if (!result.data.text.trim() && fileType === "pdf") {
            return extractTextFromPdfWithImages({ file, fileContent, textFormat }, callback)
        }
        return { success: true, text: result.data.text }

    }
    catch (e) {
        return { success: false, error: e }
    }
}

const previewFile = async ({ file, fileContent, options }) => {
    const form = new FormData();

    let fileName = file.path.replace(/\\/g, "/").split("/").pop()
    let inputPath = tempDir + fileName;

    writeFileSync(inputPath, fileContent, "base64")
    form.append('file', createReadStream(inputPath));
    if (options?.size) {
        form.append('width', options.size[0].toString());
        form.append('height', options.size[1].toString());
    }
    if (options?.quality) {
        form.append('quality', options.quality.toString());
    }
    if (options?.type) {
        form.append('type', options.type);
    }
    if (options?.page) {
        form.append('page', options.page.toString());
    }
    if (options?.density) {
        form.append('density', options.density.toString());
    }
    if (options?.hiRes) {
        form.append('hiRes', "1");
    }
    try {
        const response = await instance.post(process.env.PREVIEW_GENERATOR_URL, form, { responseType: 'stream', ...form.getHeaders() })
        let path = inputPath.split(".")
        path.pop()
        path.push("jpg")
        const previewPath = path.join(".")
        const str = createWriteStream(previewPath)
        await response.data.pipe(str)
        await new Promise(resolve => {
            response.data.on("end", () => setTimeout(resolve, 200))
        })
        const fileData = readFileSync(previewPath, "base64")
        try {
            unlinkSync(previewPath)
            unlinkSync(inputPath)
        }
        catch (e) { }

        if (response.status !== 200)
            return { success: false, error: response }

        return { success: true, data: { filename: "preview_" + file.path.replace(/\\/g, "/").split("/").pop(), path: path.join("."), content: fileData, mimetype: response.headers["content-type"], size: Number(response.headers["content-length"]) } }
    }
    catch (e) {
        return { success: false, error: e }
    }
}

const makePdfWithTextLayer = async ({ file, fileContent }) => {
    let fileName = file.path.replace(/\\/g, "/").split("/").pop()
    let outputPath = tempDir + fileName;
    let path = outputPath.split(".")
    path.pop()
    path.push("pdf")
    const outputPdfPath = path.join(".")
    let fileExt = fileName.split(".").pop();

    const imageBuffer = Buffer.from(fileContent, "base64");
    const pdfDoc = await PDFDocument.create();

    const result = await instance.post(process.env.TEXTRACT_URL, {
        data: fileContent,
        "file_type": fileExt,
        withCoords: true,
        encoding: null
    })

    let image: any
    if (fileExt === "png")
        image = await pdfDoc.embedPng(imageBuffer);
    else if (["jpg", "jpeg"].includes(fileExt))
        image = await pdfDoc.embedJpg(imageBuffer)

    const { width, height } = image.scale(1);

    // Стъпка 2: Добавяне на текстовия слой
    const doc = new PDFDocumentKit({ size: [width, height], font: 'Courier' });
    const outputStream = createWriteStream(outputPdfPath);

    doc.pipe(outputStream);

    // Добавяне на оригиналния PDF
    doc.image(imageBuffer, 0, 0, { width, height });

    // Добавяне на текстов слой
    result.data?.data?.forEach(({ text, left, top, width, height: textHeight }) => {
        doc.fillColor('black').fillOpacity(0).fontSize(textHeight).text(text, left, top, { width, height: textHeight });
    });

    doc.end();
    await new Promise(resolve => doc.on('end', resolve));
    await wait(2000)
    const fileData = readFileSync(outputPdfPath, "base64")
    const stats = statSync(outputPdfPath)
    try {
        unlinkSync(outputPdfPath)
    }
    catch (e) { }

    const filename = file.path.replace(/\\/g, "/").split("/").pop()


    return { success: true, data: { filename, path: outputPdfPath, content: fileData, mimetype: "application/pdf", size: stats.size } }

}

const convertFile = async ({ file, fileContent, options }) => {
    const form = new FormData();

    let fileName = file.path.replace(/\\/g, "/").split("/").pop()
    let inputPath = tempDir + fileName;
    let fileExt = fileName.split(".").pop();
    if (["jpg", "jpeg", "png"].includes(fileExt) && (!file.convertType || file.convertType === "pdf"))
        return await makePdfWithTextLayer({ file, fileContent })

    writeFileSync(inputPath, fileContent, "base64")
    form.append('file', createReadStream(inputPath));

    if (file.convertType) {
        form.append('type', file.convertType || "pdf");
    }

    try {
        const response = await instance.post(process.env.UNOCONVERT_URL, form, { responseType: 'stream', ...form.getHeaders() })
        let path = inputPath.split(".")
        path.pop()
        path.push(file.convertType)
        const previewPath = path.join(".")
        const str = createWriteStream(previewPath)
        await response.data.pipe(str)
        await new Promise(resolve => {
            response.data.on("end", () => setTimeout(resolve, 200))
        })
        const fileData = readFileSync(previewPath, "base64")
        try {
            unlinkSync(previewPath)
            unlinkSync(inputPath)
        }
        catch (e) { }

        if (response.status !== 200)
            return { success: false, error: response }

        const filename = file.path.replace(/\\/g, "/").split("/").pop()

        return { success: true, data: { filename, path: inputPath, content: fileData, mimetype: response.headers["content-type"], size: Number(response.headers["content-length"]) } }
    }
    catch (e) {
        return { success: false, error: e }
    }
}

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

    process.on('SIGINT', exitHandler.bind(null, { exit: true }));
    process.on('SIGUSR1', exitHandler.bind(null, { exit: true }));
    process.on('SIGUSR2', exitHandler.bind(null, { exit: true }));
}

let currentResponse
const waitToUploadFile = task_id =>
    new Promise((resolve: any) => {
        let interval = setInterval(() => {
            if (task_id === currentResponse?._id) {
                clearInterval(interval)
                resolve(currentResponse)
            }
        }, 2)
    })

const saveFile = async (fileWorkerQueue, data) => {
    const task_id = await fileWorkerQueue.push(process.env.FILE_MANAGER_CHANNEL, { input_channel: process.env.FILE_MANAGER_CHANNEL, output_channel: fileManagerCallbackChannel, payload: data })
    return await waitToUploadFile(task_id);
}


const run = async () => {
    if (status !== statuses.stop)
        return console.error(`${name} is already started`);

    status = statuses.running;
    // initErrorHandling({mode: process.env.NODE_ENV, dsn: process.env.SENTRY_DSN, serverName: `${name}` });
    const pubSub = new PubSub()
    await pubSub.init({ protocol: process.env.REDIS_PROTOCOL, host: process.env.REDIS_HOST, port: parseInt(process.env.REDIS_PORT) })
    const workerQueue = new WorkerQueue()
    await workerQueue.init({ protocol: process.env.REDIS_PROTOCOL, host: process.env.REDIS_HOST, port: parseInt(process.env.REDIS_PORT) })

    const fileWorkerQueue = new WorkerQueue()
    await fileWorkerQueue.init({ protocol: process.env.REDIS_PROTOCOL, host: process.env.REDIS_HOST, port: parseInt(process.env.REDIS_PORT) })
    const filePubSub = new PubSub()
    await filePubSub.init({ protocol: process.env.REDIS_PROTOCOL, host: process.env.REDIS_HOST, port: parseInt(process.env.REDIS_PORT) })
    filePubSub.on(fileManagerCallbackChannel, response => {
        console.log(response.data._id)
        currentResponse = response.data
    })

    console.log("channel", process.env.FILE_UTILS_CHANNEL)
    workerQueue.subscribe(process.env.FILE_UTILS_CHANNEL, async (inputData: { _id: string, taskData: ITaskData }, readyCb) => {
        const { _id, taskData } = inputData;
        console.log(`${name} received task`, _id)
        status = statuses.processing;

        const { input_channel, output_channel, payload } = taskData;
        const { user, data } = payload
        const sizes = data.sizes;
        const preview: { name?: string, type?: string, quality?: number, size?: number[] } = data.preview;
        const actions: Actions[] = data.actions;
        let outputData;

        if (data.test) {
            outputData = { _id: _id, test: true, success: true }
            output_channel ? await pubSub.fire(output_channel, { user, data: outputData, type: outputName, ids: [user.id], send_to_himself: true }) : null
        }
        else {
            outputData = {
                _id: _id,
                name: data.filename,
                type: data.type,
                contentType: data.mimetype
            }

            try {
                const fileContent = data.content;

                if (!actions?.length || actions.includes(Actions.optimizeImage)) {
                    console.log("Optimize images")
                    outputData.stepName = Actions.optimizeImage
                    let error = null
                    for (let size of sizes) {
                        let fileData: any = await previewFile({ file: data, fileContent: fileContent, options: size })
                        if (!fileData.error) {
                            console.log(size.prefix + "_" + data.filename)
                            const saveRes: any = await saveFile(fileWorkerQueue, {
                                user,
                                data: {
                                    filename: size.prefix + "_" + data.filename,
                                    content: fileData.data.content,
                                    mimetype: data.mimetype,
                                    action: "write",
                                    fileManagerSettings: data.fileManagerSettings
                                }
                            });
                            if (saveRes.error) {
                                error = saveRes
                            }
                        }
                        else {
                            error = fileData
                        }
                    }
                    outputData.thumb = error ? error : sizes?.[0]?.prefix + "_" + data.filename
                    output_channel ? await pubSub.fire(output_channel, { user, data: outputData, type: outputName, ids: [user.id], send_to_himself: true }) : null
                }
                if (actions?.includes(Actions.textract)) {
                    console.log("extractText: format", data.textFormat || "text")
                    outputData.stepName = Actions.textract
                    let result = await extractText({ file: data, fileContent: fileContent, textFormat: data.textFormat }, async (data: any) => {
                        output_channel ? pubSub.fire(output_channel, { user, data: Object.assign({}, outputData, data), type: outputName, ids: [user.id], send_to_himself: true }) : null

                    })
                    if (result.error) {
                        console.error(result)
                    }

                    outputData.text = result.text || result;
                    output_channel ? await pubSub.fire(output_channel, { user, data: outputData, type: outputName, ids: [user.id], send_to_himself: true }) : null
                }
                if (actions?.includes(Actions.preview)) {
                    console.log("generating preview")
                    outputData.stepName = Actions.preview
                    let fileData: any = await previewFile({ file: data, fileContent: fileContent, options: preview })
                    let fileName: any = preview.name + "_" + data.filename
                    fileName = fileName.split(".")
                    fileName.pop()
                    fileName.push(preview.type)
                    fileName = fileName.join(".")

                    if (fileData.error) {
                        console.error(fileData.error)
                        outputData = Object.assign({ _id }, { preview: fileData })
                        output_channel ? await pubSub.fire(output_channel, { user, data: outputData, type: outputName, ids: [user?.id], send_to_himself: true }) : null
                    }
                    else {
                        const pSaveRes: any = await saveFile(fileWorkerQueue, {
                            user,
                            data: {
                                filename: fileName,
                                content: fileData.data.content,
                                mimetype: fileData.data.mimetype,
                                action: "write",
                                fileManagerSettings: data.fileManagerSettings
                            }
                        });
                        let pError = pSaveRes.error ? pSaveRes : null
                        outputData.preview = pError ? pError : fileName
                        outputData.stepName = Actions.preview
                        output_channel ? await pubSub.fire(output_channel, { user, data: outputData, type: outputName, ids: [user.id], send_to_himself: true }) : null

                        for (let size of sizes) {
                            console.log("previewSize:", size)
                            let sizeData: any = await previewFile({ file: fileData.data, fileContent: fileData.data?.content|| fileData.content, options: size })
                            await saveFile(fileWorkerQueue, {
                                user,
                                data: {
                                    filename: size.prefix + "_" + fileName,
                                    content: sizeData.data?.content || fileData.content,
                                    mimetype: sizeData.data?.mimetype || fileData.mimetype,
                                    action: "write",
                                    fileManagerSettings: data.fileManagerSettings
                                }
                            });
                        }

                        outputData.thumb = sizes?.[0]?.prefix + "_" + fileName
                        output_channel ? await pubSub.fire(output_channel, { user, data: outputData, type: outputName, ids: [user.id], send_to_himself: true }) : null
                        console.log("generating preview finished")
                    }
                }
                if (actions?.includes(Actions.convert)) {
                    outputData.stepName = Actions.convert
                    if (data.filename.split(".").pop() === (data.convertType || "pdf"))
                        output_channel ? await pubSub.fire(output_channel, { user, data: outputData, type: outputName, ids: [user.id], send_to_himself: true }) : null
                    else {
                        console.log("Convert file to", data.convertType || "pdf")
                        let fileData: any = await convertFile({ file: data, fileContent: fileContent, options: preview })
                        let fileName: any = data.filename
                        fileName = fileName.split(".")
                        fileName.pop()
                        fileName.push(data.convertType || "pdf")
                        fileName = fileName.join(".")
                        outputData = Object.assign({ _id }, { name: fileName, contentType: fileData.data.mimetype })

                        if (fileData.error) {
                            console.error(fileData.error)
                            output_channel ? await pubSub.fire(output_channel, { user, data: outputData, type: outputName, ids: [user.id], send_to_himself: true }) : null
                        }
                        else {
                            const pSaveRes: any = await saveFile(fileWorkerQueue, {
                                user,
                                data: {
                                    filename: fileName,
                                    content: fileData.data.content,
                                    mimetype: fileData.data.mimetype,
                                    action: "write",
                                    fileManagerSettings: data.fileManagerSettings
                                }
                            });
                            let pError = pSaveRes.error ? pSaveRes : null
                            outputData.preview = pError ? pError : fileName
                            output_channel ? await pubSub.fire(output_channel, { user, data: outputData, type: outputName, ids: [user.id], send_to_himself: true }) : null
                        }
                    }
                }
            }
            catch (e) {
                console.error(e)
                outputData = { _id: _id, error: e }
                output_channel ? await pubSub.fire(output_channel, { user, data: outputData, type: outputName, ids: [user.id], send_to_himself: true }) : null
            }
        }

        readyCb()
        status = statuses.idle;

        console.log(`${name} finished task`, _id)
    })

    attachExitEvent(workerQueue, pubSub);

    status = statuses.idle
    console.log(`${name} was started`);

    process.stdin.on("data", () => { });//so the program will not close instantly
}

run().catch(console.error);
