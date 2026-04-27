FROM python:3.12-slim

WORKDIR /app

COPY rummy5000/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# DoddGames static files
COPY index.html .
COPY manifest.json .
COPY icon-192.png .
COPY icon-512.png .
COPY css/ ./css/
COPY js/ ./js/
COPY reversi/ ./reversi/

# Rummy 5000 application
COPY rummy5000/ ./rummy5000/

# Unified server
COPY server.py .

CMD gunicorn server:app --bind 0.0.0.0:$PORT --workers 1 --timeout 120
