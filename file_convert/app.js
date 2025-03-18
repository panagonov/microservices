const path  = require("path");
const fs     = require("fs");
const multer = require("multer");
const {exec} = require("child_process");
const express = require("express");
const bodyParser = require('body-parser');

const uploadPath = `${__dirname}/_upload`

let convertFile = async (source, type="pdf") =>
    new Promise((resolve, reject) => {
        const command = `unoconv -f ${type} ${source}`
        console.log(command);
        exec(command, (err) => {
            if (err)
                return reject(err);
            let dest = source.split(".");
            dest.pop();
            dest.push(type)
            resolve(dest.join("."));
        })
    });

let previewFromFile = async (source, options) => {
    return new Promise((resolve, reject) => {
        const dest = `${options.savePath}/${options.saveFilename}.${options.page}.${options.format}`;
        let command = `convert "${source}[${options.page - 1}]" "-density" "${options.density}x${options.density}" "-quality" ${options.quality} ${options.width ? `"-resize" "${options.width}x${options.height}"` : ""}  "-background" "white" -flatten "-alpha" "Off" -antialias "${dest}"`
        if(options.hiRes)
            command = `gs -dNOPAUSE -dBATCH -sDEVICE=jpeg -r${options.density} -dJPEGQ=${options.quality} -dFirstPage=${options.page} -dLastPage=${options.page} -sOutputFile=${dest} ${source}`
        console.log(command);

        exec(command, (err) => {
            if (err) {
                return reject(err)
            }
            resolve(dest);
        })
    });
}

const removeFile = (file_path) => {
    try {
        fs.unlinkSync(file_path)
    }
    catch(e) {}
};

let resFile = (res, file_path, file_type) =>
    new Promise((resolve, reject) => {
        res.writeHead(200,{'Content-Type': file_type, 'Content-Length': fs.statSync(file_path).size});

        fs.createReadStream(file_path)
        .pipe(res)
        .on("finish", () =>
        {
            removeFile(file_path);
            resolve({})
        })
        .on("error", (e) => {
            console.error(e);
            resolve({})
        });
    });

(async() => {
    const port = 3314
    const app = express();
    app.use(bodyParser.json({limit: "10mb"}));
    app.use(bodyParser.urlencoded({extended: true, limit: "10mb"}));

    let upload_dir = path.normalize(uploadPath);
    if (!fs.existsSync(upload_dir))
        fs.mkdirSync(upload_dir, {recursive: true});

    if (!fs.existsSync(`${uploadPath}/preview`))
        fs.mkdirSync(`${uploadPath}/preview`, {recursive: true});

    let storage =  multer.diskStorage({
        destination: function (req, file, cb) {
            cb(null, upload_dir)
        },
        filename: function (req, file, cb) {
            let name = file.originalname;
            cb(null, name )
        }
    });

    app.post("/convert", multer({storage: storage}).single('file'), async(req, res) => {
        const path = req.file.path
        const type = req.body.type || "pdf"

        console.log("Start file converter:", req.file.filename)

        let pdfPath = path
        if(req.file.mimetype !== "application/pdf") {
            try  {
                pdfPath = await convertFile(path, type);
                await resFile(res, pdfPath, "application/pdf");
                removeFile(pdfPath);
            }
            catch(e) {
                console.error(e)
                res.status(300).json({error: e})
            }
        }
        else {
            await resFile(res, pdfPath, "application/pdf");
        }
        removeFile(path);

        console.log("Finish file converter:", req.file.filename)
    })

    app.post("/preview", multer({storage: storage}).single('file'), async(req, res) => {
        const file = req.file;
        const path = file.path
        const type = req.body.type
        const quality = req.body.quality
        const width = req.body.width
        const height = req.body.height
        const density = req.body.density
        const page = Number(req.body.page || 1)
        const hiRes = req.body.hiRes

        let pdfPath = path
        if (file.mimetype.indexOf("image") !== 0) {
            if(file.mimetype !== "application/pdf") {
                try {
                    pdfPath = await convertFile(path, "pdf");
                }
                catch(e) {
                    console.error(e);
                    res.status(300).json({error: e})
                    return removeFile(path);
                }
            }
        }

        const options = {
            density: density || 72,
            quality: quality || 75,
            saveFilename: file.filename,
            savePath: `${uploadPath}/preview`,
            format: type || "jpg",
            ...width ? {width: Number(width)} : "",
            ...height ? {height: Number(height)}: "",
            page: page || 1,
            ...hiRes === "1" && {hiRes: true}
        };

        console.log("Start preview generator:", file.filename)

        try {
            const destPath = await previewFromFile(pdfPath, options)
            await resFile(res, destPath, `image/${options.format}`);
        }
        catch(e) {
            console.error(e)
            res.status(300).json({error: e})
        }

        console.log("Finish preview generator:", file.filename)
        removeFile(path);
        removeFile(pdfPath);
    })

    app.listen(port, () => {
        console.info(`UnoConverter is READY!!! - http://localhost${port ? ":" + port : ""}`);
    });
})().catch(e => {
    console.log("--- UNCAUGHT ASYNC EXCEPTION ---");
    console.log(e);
});

process.on('uncaughtException', function (err, data) {
    // global.services.error_handling ? global.services.error_handling.error(err) : null;
    console.log("--- UNCAUGHT EXCEPTION ---");
    console.log(err);
    console.log("[Inside 'uncaughtException' event] " + err.stack || err.message);
    console.log(data);
});
