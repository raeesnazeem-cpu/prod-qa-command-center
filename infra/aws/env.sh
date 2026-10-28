# Shared helpers for the infra/aws scripts. Source it, don't run it.
# Terraform and the AWS CLI run in Docker, so the only thing to install is Docker.
# Your AWS login comes from ~/.aws (run `aws configure sso` or `aws configure`
# once — see infra/README.md) and the profile in AWS_PROFILE.
aws_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$aws_dir/../.." && pwd)"
tf_dir="$repo/infra/terraform"
: "${AWS_PROFILE:=qacc}"
: "${AWS_REGION:=us-east-1}"
export AWS_PROFILE AWS_REGION

aws() {
  docker run --rm -i -v "$HOME/.aws:/root/.aws" -v "$repo:/repo" -w /repo \
    -e AWS_PROFILE -e AWS_REGION -e AWS_PAGER= amazon/aws-cli:2.22.0 "$@"
}

tf() {
  docker run --rm -i $([ -t 0 ] && echo -t) -v "$HOME/.aws:/root/.aws:ro" -v "$tf_dir:/tf" -w /tf \
    -e AWS_PROFILE -e AWS_REGION hashicorp/terraform:1.9.8 "$@"
}

# Read one value from prod.tfvars (simple `key = "value"` lines).
tfvar() {
  [ -f "$tf_dir/prod.tfvars" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*\"\{0,1\}\([^\"]*\)\"\{0,1\}[[:space:]]*$/\1/p" "$tf_dir/prod.tfvars" | head -1
}

tfout() { tf output -raw "$1" 2>/dev/null | tr -d '\r'; }

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
