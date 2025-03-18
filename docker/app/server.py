import os
import sys
import aiohttp
import asyncio
import uvicorn
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

import json
import textract as txrct
import tempfile
import pytesseract
from pytesseract import Output

from base64 import b64decode

app = Starlette()
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_headers=['X-Requested-With', 'Content-Type'])



@app.route('/textract', methods=['POST'])
async def textract(request):      
    data = await request.body()
    data_json = json.loads(data)
    file_type = data_json['file_type']
    file_dec = b64decode(data_json['data'])
    width_coords = data_json.get('withCoords', False) 

    print("Textract Start")

    suffix = f'.{file_type}'

    temp_file = tempfile.NamedTemporaryFile(suffix=suffix, delete=False) 
    try:
        temp_file.write(file_dec)
        temp_file.close()

        text = txrct.process(temp_file.name, language='eng+spa+fra+deu+ita+por+rus+pol+nld+swe+ell+ces+dan+nor+fin+hun+bul')
        print("Textract text completed")

        extracted_data = []
        if width_coords:
            ocr_result = pytesseract.image_to_data(
                    temp_file.name, 
                    lang='eng+spa+fra+deu+ita+por+rus+pol+nld+swe+ell+ces+dan+nor+fin+hun+bul',
                    output_type=Output.DICT,
                    config='--psm 6'
                )
            for i in range(len(ocr_result['text'])):
                if ocr_result['text'][i].strip():  # Пропускане на празните текстове
                    extracted_data.append({
                        'text': ocr_result['text'][i],
                        'left': ocr_result['left'][i],
                        'top': ocr_result['top'][i],
                        'width': ocr_result['width'][i],
                        'height': ocr_result['height'][i]
                    })
            print("Textract coords completed")

    finally:
        os.unlink(temp_file.name)

    resp = {
        'text': text.decode('utf-8'),
        'data': extracted_data
        }
    return JSONResponse(resp)

@app.route('/status', methods=['GET'])
def status(request):
    res = {'status': 'OK'}
    return JSONResponse(res)

if __name__ == '__main__':
    if 'serve' in sys.argv:
        uvicorn.run(app=app, host='0.0.0.0', port=int(os.environ.get('PORT', 8080)), log_level="info")