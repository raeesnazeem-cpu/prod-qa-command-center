# qacc-dbtools: one-off database jobs on AWS (RDS is private; run inside the VPC
# as an ECS task with infra/aws/db-task.sh). Build from the repo root:
#   docker build -f infra/db/Dockerfile -t qacc-dbtools:<tag> .
FROM node:20-alpine
RUN apk add --no-cache bash postgresql16-client aws-cli
WORKDIR /app
COPY infra/db ./infra/db
COPY supabase/migrations ./supabase/migrations
ENV PSQL_DOCKER=0
ENTRYPOINT ["/app/infra/db/dbtools.sh"]
CMD ["help"]
