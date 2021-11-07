import { Handler } from "aws-lambda";
import { Duplex } from "stream";
const management = require("contentful-management");
const Jimp = require("jimp");

const { SPACE_ID, WATERMARK_IMAGE_URL, CMA_ACCESS_TOKEN } = process.env;

const addWatermarkToString = (str: string) => `[WATERMARKED] ${str}`;

const bufferToStream = (buffer: string) => {
	let stream = new Duplex();
	stream.push(buffer);
	stream.push(null);
	return stream;
};

const decodeEventBody = (body: string) => {
	if (!body) return null;
	try {
		const buff = Buffer.from(body, "base64");
		const text = buff.toString();
		return JSON.parse(text);
	} catch (error) {
		return null;
	}
};

const uploadAsset = async ({
	title,
	description,
	fileName,
	contentType,
	stream,
}) => {
	const client = management.createClient({ accessToken: CMA_ACCESS_TOKEN });
	const space = await client.getSpace(SPACE_ID);
	const env = await space.getEnvironment("master");
	let asset = await env.createAssetFromFiles({
		fields: {
			title: {
				es: title,
			},
			description: {
				es: description,
			},
			file: {
				es: {
					contentType,
					fileName,
					file: stream,
				},
			},
		},
	});
	asset = await asset.processForAllLocales();
	asset = await asset.publish();
};

const getResponseObject = (
	statusCode: number,
	message = "No message provided"
) => {
	return {
		statusCode,
		message,
	};
};

export const watermark: Handler = async (event: any) => {
	try {
		// Decode event body
		const body = decodeEventBody(event.body);

		const { url, title, description, fileName, contentType, width, height } =
			body;

		if (/^\[WATERMARKED\]/.test(fileName)) {
			console.log("Skipped this hook... It's marked alreay.");
			return getResponseObject(200, "Skipped - marked already");
		}

		const original = await Jimp.read(`https:${url}`);
		const mark = await Jimp.read(WATERMARK_IMAGE_URL);

		mark.opacity(0.5);

		const watermarkedImage = original.composite(mark, 50, 50);

		// upload the watermarked result image back to contentful
		await uploadAsset({
			title: addWatermarkToString(title),
			contentType,
			description,
			fileName: addWatermarkToString(fileName),
			stream: bufferToStream(await watermarkedImage.getBufferAsync(Jimp.AUTO)),
		});

		const response = {
			statusCode: 200,
			body: JSON.stringify(
				{
					message: `Image ${title} watermarked successfully`,
					input: { ...body },
				},
				null,
				2
			),
		};

		return response;
	} catch (error) {
		return {
			statusCode: 500,
			error: error.message,
		};
	}
};
