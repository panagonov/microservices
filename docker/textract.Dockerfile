FROM python:3.8-buster

RUN apt-get update && apt-get install -y libxml2-dev libxslt1-dev antiword unrtf poppler-utils tesseract-ocr \
flac ffmpeg lame libmad0 libsox-fmt-mp3 sox libjpeg-dev swig 
RUN apt-get install -y tesseract-ocr-eng tesseract-ocr-spa tesseract-ocr-fra tesseract-ocr-deu tesseract-ocr-ita tesseract-ocr-por tesseract-ocr-rus tesseract-ocr-pol tesseract-ocr-nld tesseract-ocr-swe tesseract-ocr-ell tesseract-ocr-ces tesseract-ocr-dan tesseract-ocr-nor tesseract-ocr-fin tesseract-ocr-hun tesseract-ocr-bul

RUN pip install aiohttp asyncio aiofiles uvicorn starlette textract pytesseract python-pptx xlrd docx2txt

WORKDIR /workdir 
COPY app /workdir/

EXPOSE $PORT

ENTRYPOINT ["python", "-u", "server.py", "serve"]