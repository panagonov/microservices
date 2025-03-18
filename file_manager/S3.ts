import { waitForDebugger } from "inspector";

const AWS = require('aws-sdk');
const readRetry = 5;
const delayBetweenRetries = 100

interface InitProps {
    type: any,
    path: any,
    region?: string;
    pass?: string;
    user?: string
}

const wait = (delay: number) => 
    new Promise(resolve =>  setTimeout(resolve, delay))

class S3 {
    s3
    bucket
    constructor(config : InitProps) {
        AWS.config.update({
            region: config.region,
            accessKeyId: config.user,
            secretAccessKey: config.pass
        });
        this.bucket = config.path;
        try {
            this.s3 = new AWS.S3();
        }
        catch(e) {
            console.error(config)
            console.error(e);
            this.s3 = {}
        }
    }

    upload(params, user_id, file_name, progress_cb) {
        return new Promise((resolve) => {
            let default_params = {
                Bucket: this.bucket,
                ACL: 'public-read',
                CacheControl: 'max-age=31536000',
                Metadata : {}
            };

            params = Object.assign({}, default_params, params);

            let upload = new AWS.S3.ManagedUpload({
                params: params,
                partSize: 5 * 1024 *1024,
                queueSize: 1
            });

            upload.send((err, result) => {
                if (err) {
                    console.error(err);
                    return resolve({error: err})
                }
                resolve(result)
            });

            upload.on("httpUploadProgress", (progress) => {
                let percents = ((progress.loaded / progress.total ) * 100) || 0;
                progress_cb ? progress_cb(percents) : null;
            })

            //upload.abort.bind(upload) //todo abort function
        });
    }

    async write({fileName, fileContent, contentType, meta = {}}, progress_cb) {
        const params = {
            Bucket      : this.bucket,
            Body        : fileContent,
            Key         : fileName,
            ContentType : contentType || "application/octet-stream",
            CacheControl: "max-age=31536000",
            Metadata    : meta
        }
        return await this.upload(params, null, null, progress_cb)
    }

    remove(key: string) {
        return new Promise((resolve) => {
            let params = {
                Bucket : this.bucket,
                Key    : key,
            };
            this.s3?.deleteObject?.( params, (err, result) => {
                if (err)
                    return resolve({error: err})
                resolve(result)
            });
        });
    }

    async read(key: string) {
        let isExists = false
        for(let i = 0; i < readRetry; i++) {
            isExists = await this.exists(key)
            if(isExists)
                break;
            await wait(delayBetweenRetries)
        }
        if(!isExists) {
            return {error: "File not found"}
        }
        return new Promise((resolve) => {
            let params = {
                Bucket : this.bucket,
                Key    : key,
            };

            this.fileInfo(key).then((result: any) => {
                var chunks = [];
                var totalLength = 0;
                let s3Stream
                try{
                    s3Stream = this.s3?.getObject?.(params).createReadStream();
                    s3Stream.on('data', function(chunk) {
                        chunks.push(chunk);
                        totalLength += chunk.length;
                    });
    
                    s3Stream.on('finish', function() {
                        resolve({
                            name: key,
                            Body: Buffer.concat(chunks, totalLength),
                            ContentLength: result.ContentLength,
                            ContentType: result.ContentType,
                            Metadata: {}
                        })
                    });
                }
                catch(e ){
                    resolve({error: e})
                }
            }).catch((e) => resolve({error: e}))
        })
    }

    exists(key: string): Promise<boolean> {
        return new Promise((resolve) => {
            let params = {
                Bucket : this.bucket,
                Key    : key,
            };
            this.s3.headObject?.( params, (err, result) => {
                console.log("exists", result)
                if (err)
                    return resolve(false)
                resolve(true)
            });
        })
    }

    fileInfo(key: string) {
        return new Promise((resolve) => {
            let params = {
                Bucket : this.bucket,
                Key    : key,
            };
            this.s3.headObject?.( params, (err, result) => {
                if (err)
                    return resolve({error: err})
                resolve(result)
            });
        })
    }

}

export default  S3;
