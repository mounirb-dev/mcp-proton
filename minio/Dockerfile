# MinIO sobre Alpine (paquetes oficiales de Alpine: minio + minio-client). La imagen oficial de MinIO es UBI, no Alpine.
FROM docker.io/library/alpine:3.22
RUN apk add --no-cache minio minio-client ca-certificates \
 && mkdir -p /data && chown minio:minio /data
COPY --chmod=0755 entrypoint.sh /usr/local/bin/minio-entrypoint.sh
USER minio
VOLUME ["/data"]
EXPOSE 9000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:9000/minio/health/ready || exit 1
ENTRYPOINT ["minio-entrypoint.sh"]
