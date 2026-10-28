#!/usr/bin/env bash
# Run one database job inside AWS (RDS is private) and print its log.
#   infra/aws/db-task.sh schema
#   infra/aws/db-task.sh counts
#   infra/aws/db-task.sh restore s3://<media bucket>/migration/qacc.dump
#   infra/aws/db-task.sh rewrite-urls https://<old-project>.supabase.co
#   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… infra/aws/db-task.sh copy-storage
# The image is qacc-dbtools (infra/db/Dockerfile); commands are in infra/db/dbtools.sh.
set -euo pipefail
. "$(dirname "$0")/env.sh"
[ $# -ge 1 ] || { sed -n '2,8p' "$0"; exit 1; }

cluster=$(tfout cluster)
subnets=$(tf output -json private_subnet_ids | tr -d '\r[]" \n')
sg=$(tfout tasks_security_group_id)
family="qacc-$(tfvar env)-dbtools"

cmd_json=$(printf '%s\n' "$@" | docker run --rm -i node:20-alpine node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(s.trimEnd().split("\n"))))')
env_json='[]'
if [ "$1" = copy-storage ]; then
  : "${SUPABASE_URL:?set SUPABASE_URL of the OLD project}" "${SUPABASE_SERVICE_ROLE_KEY:?set SUPABASE_SERVICE_ROLE_KEY of the OLD project}"
  env_json="[{\"name\":\"SUPABASE_URL\",\"value\":\"$SUPABASE_URL\"},{\"name\":\"SUPABASE_SERVICE_ROLE_KEY\",\"value\":\"$SUPABASE_SERVICE_ROLE_KEY\"}]"
fi

say "Starting $family: $*"
task=$(aws ecs run-task --cluster "$cluster" --task-definition "$family" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$sg],assignPublicIp=DISABLED}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"dbtools\",\"command\":$cmd_json,\"environment\":$env_json}]}" \
  --query 'tasks[0].taskArn' --output text | tr -d '\r')
echo "task: $task"
echo "waiting for it to finish (a restore or copy can take a long time)…"
aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task" || \
  aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$task"

id=${task##*/}
say "Log"
aws logs get-log-events --log-group-name "/ecs/qacc-$(tfvar env)-dbtools" \
  --log-stream-name "dbtools/dbtools/$id" --start-from-head --query 'events[].message' --output text | tr '\t' '\n'
code=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task" \
  --query 'tasks[0].containers[0].exitCode' --output text | tr -d '\r')
say "Exit code: $code  (0 = success)"
[ "$code" = 0 ]
