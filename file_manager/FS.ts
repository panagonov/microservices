import {unlinkSync, readFileSync, writeFileSync, existsSync} from "fs";
import {resolve, join} from "path";

interface InitProps {
    type: string
    path: string
}

class LocalFile {
    mainPath : string

    constructor(config : InitProps) {
        this.mainPath = config.path
    }

    async write({fileName, fileContent, contentType, meta = {}}, progress_cb) {
        try {
            writeFileSync(resolve(join(this.mainPath, fileName)), fileContent);
            progress_cb ? progress_cb(100) : null
            return {success: true}
        }
        catch(e){
            return {error : e}

        }
    }

    async remove(fileName: string) {
        try {
            unlinkSync(resolve(join(this.mainPath, fileName)));
            return {success: true}
        }
        catch(e) {
            return {error: e}
        }
    }

    async read(fileName: string) {
        try {
            const fileContent = readFileSync(resolve(join(this.mainPath, fileName)))
            return {
                Body: fileContent,
                meta: {}
            }
        }
        catch(e) {
            return {error: e}
        }
    }

    async exists(fileName: string) {
        return existsSync(resolve(join(this.mainPath, fileName)))
    }
}

export default LocalFile;
