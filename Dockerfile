FROM python:3.12-slim

WORKDIR /app

COPY rummy5000/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY rummy5000/ .

CMD gunicorn app:app --bind 0.0.0.0:$PORT --workers 1
