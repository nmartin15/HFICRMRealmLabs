#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
PREFIX="${BACKUP_S3_PREFIX:-pg}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
FILE="/tmp/realm-labs-crm-${STAMP}.dump"
KEY="${PREFIX}/realm-labs-crm-${STAMP}.dump"

export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}"
export AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}"
export AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-${AWS_DEFAULT_REGION:-auto}}"

aws_s3() {
  if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
    aws s3 "$@" --endpoint-url "${BACKUP_S3_ENDPOINT}"
  else
    aws s3 "$@"
  fi
}

pg_dump --format=custom --no-owner --no-acl --file="${FILE}" "${DATABASE_URL}"
aws_s3 cp "${FILE}" "s3://${BACKUP_S3_BUCKET}/${KEY}"
rm -f "${FILE}"

CUTOFF="$(date -u -d "${RETENTION_DAYS} days ago" +%Y-%m-%dT%H-%M-%SZ)"
aws_s3 ls "s3://${BACKUP_S3_BUCKET}/${PREFIX}/" | while read -r _date _time _size object; do
  [ -n "${object:-}" ] || continue
  stamp="${object#realm-labs-crm-}"
  stamp="${stamp%.dump}"
  if [ "${stamp}" \< "${CUTOFF}" ]; then
    aws_s3 rm "s3://${BACKUP_S3_BUCKET}/${PREFIX}/${object}"
  fi
done
