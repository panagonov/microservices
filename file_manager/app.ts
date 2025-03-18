import S3 from "./S3";
import LocalFile from "./FS";

export enum EManagerType {
    S3 = "S3",
    FS = "FS"
}

interface Settings {
    type: EManagerType,
    path: string,
    user?: string,
    pass?: string,
    region?: string
}

class FileManager {
    manager
    constructor(settings : Settings){
        switch(settings.type) {
            case EManagerType.S3 :
                this.manager = new S3(settings);
                break;
            case EManagerType.FS:
                this.manager = new LocalFile(settings);
                break;
        }
    }
    async readFile(name: string) {
        if(!name){
            return {error: -444, message: "Missing file name to read"}
        }
        try{
            let result = await this.manager.read(name);
            if(result.error)
                return result
    
            return {
                name: name,
                type: result.Metadata?.type,
                content: result.Body,
                content_type: result.ContentType,
                content_length: result.ContentLength,
                meta: result.Metadata,
            }
        }catch(e: any){
            return {error: -444, message: e.toString()}
        }
    }

    async writeFile({name, content, content_type, meta}){
        if(!name){
            return {error: -443, message: "Missing file name to write"}
        }
        const params = {
            Body        : content,
            Key         : name,
            ContentType : content_type || "application/octet-stream",
            CacheControl: "max-age=31536000",
            Metadata    : meta
        }
        try {
            return await this.manager.upload(params, null, null)
        }
        catch(e) {
            return {error: -443, message: e.toString()}
        }
    }

    async removeFile (name: string) {
        if(!name){
            return {error: -445, message: "Missing file name to remove"}
        }
        try {
            return await this.manager.remove(name)
        }
        catch(e) {
            return {error: -445, message: e.toString()}
        }
    }

    async exists(name: string) {
        if(!name){
            return {error: -446, message: "Missing file name to check"}
        }
        try {
            return await this.manager.exists(name)
        }
        catch(e) {
            return {error: -446, message: e.toString()}
        }
    }

}

export default  FileManager
