FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 POETRY_VIRTUALENVS_CREATE=false
WORKDIR /srv
RUN pip install --no-cache-dir "poetry>=2,<3"
COPY pyproject.toml poetry.lock ./
RUN poetry install --only main --no-root
COPY app ./app
RUN useradd --create-home app && chown -R app /srv
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
