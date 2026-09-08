// Generates synthetic Terraform workspaces of a given size for benchmarking.
//
// The generated code is deliberately not trivial: every resource carries
// interpolation, a function call and a conditional, because a benchmark over
// literal-only attributes would measure parsing and flatter the evaluator.

import fs from 'node:fs';
import path from 'node:path';

const header = `
variable "environment" {
  type    = string
  default = "staging"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/8"
}

variable "tags" {
  type = map(string)
  default = {
    team    = "platform"
    managed = "terraform"
  }
}

locals {
  project     = lower("TerraVisual")
  name_prefix = "\${local.project}-\${var.environment}"
  is_prod     = var.environment == "production"
  common_tags = merge(var.tags, { environment = var.environment })
  tag_digest  = sha256(jsonencode(local.common_tags))
}
`;

function resource(i) {
  return `
resource "aws_subnet" "net_${i}" {
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, ${i % 250})
  availability_zone = format("%s-%d", var.environment, ${i % 3})
  name              = "\${local.name_prefix}-net-${i}"
  tags              = local.common_tags
}

resource "aws_instance" "node_${i}" {
  instance_type = local.is_prod ? "m5.large" : "t3.micro"
  name          = join("-", [local.name_prefix, "node", "${i}"])
  digest        = local.tag_digest
  retries       = max(3, ${i % 7})
  zone          = element(["a", "b", "c"], ${i % 3})
}
`;
}

const count = Number(process.argv[2] ?? 100);
const outDir = process.argv[3] ?? path.join('fixtures', `n${count}`);

// Each pair of blocks above yields two resources.
const pairs = Math.ceil(count / 2);
let body = header;
for (let i = 0; i < pairs; i++) body += resource(i);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'main.tf'), body, 'utf8');

console.log(`wrote ${outDir}/main.tf with ~${pairs * 2} resources (${Buffer.byteLength(body)} bytes)`);
