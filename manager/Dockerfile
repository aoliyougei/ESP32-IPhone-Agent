FROM python:3.12-slim-trixie
WORKDIR /app
COPY pyproject.toml ./
COPY manager ./manager
RUN pip install --no-cache-dir . && useradd --uid 10001 --create-home manager \
    && mkdir /data && chown manager:manager /data
USER 10001:10001
ENV PYTHONUNBUFFERED=1 MANAGER_DB=/data/servers.db
EXPOSE 8880
CMD ["uvicorn", "manager.app:from_env", "--factory", "--host", "0.0.0.0", "--port", "8880"]
