import resizeImage      from "resize-img";
import imagemin         from "imagemin";
import imageminJpegtran from "imagemin-jpegtran";
import sizeOf           from "buffer-image-size";

const max_width = 800;
const max_height = 600;

interface Settings {
    width?: number
    height?: number
}

export const resize = async (buffer, settings: Settings = {}) => {
    let dimensions = sizeOf(buffer);
    let width = Math.min(dimensions.width, settings.width || max_width);
    let ratio = width / dimensions.width;
    let height = Math.round(dimensions.height * ratio);
    let options: {format: string, width?: number, height?: number} = {format: "jpg"};

    if (height > (settings.height || max_height)) {
        height = (settings.height || max_height);
        ratio = height / dimensions.height;
        width = Math.round(dimensions.width * ratio);
        options.height = height;
    }
    else {
        options.width = width
    }

    return await resizeImage(buffer, options)
};

export const minimize = async buffer => {
    return await imagemin.buffer(buffer, {
        plugins: [
            imageminJpegtran(),
        ]
    })
};

export const optimize = async (buffer, settings = {}) => {
    let resized_image = await resize(buffer, settings);
    let min_image = await minimize(resized_image);
    return min_image
};
