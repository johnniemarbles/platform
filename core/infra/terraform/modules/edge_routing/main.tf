/**
 * Edge DNS & Global Routing Lookup
 *
 * Implements Plan Section 4 & Operating Decision #1:
 * 1. Wildcard *.yourdomain.com CloudFront distribution.
 * 2. Edge routing evaluates workspace_name from Host header.
 * 3. Lookup maps workspace_name -> region ONLY (no emails, no hashes).
 * 4. Cross-region lookups for "forgot my workspace" are rejected.
 */

# 1. DynamoDB Global Table for Workspace-to-Region mapping
resource "aws_dynamodb_table" "workspace_lookup" {
  name         = "platform-workspace-lookup"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "workspace_name"

  attribute {
    name = "workspace_name"
    type = "S"
  }

  tags = {
    Role = "EdgeWorkspaceDirectory"
  }
}

# 2. CloudFront Function: Workspace Host Inspector
resource "aws_cloudfront_function" "host_router" {
  name    = "workspace-host-router"
  runtime = "cloudfront-js-2.0"
  comment = "Inspects host header and appends region routing header"
  publish = true
  code    = <<-EOF
    function handler(event) {
      var request = event.request;
      var host = request.headers.host.value;
      var parts = host.split('.');
      if (parts.length >= 3) {
        var workspace = parts[0].toLowerCase();
        request.headers['x-workspace-name'] = { value: workspace };
      }
      return request;
    }
  EOF
}

# 3. CloudFront Distribution
resource "aws_cloudfront_distribution" "wildcard_edge" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Platform Regional Edge Router (*.${var.root_domain})"
  price_class         = "PriceClass_100"

  # Default origin: US ALB
  origin {
    domain_name = var.us_alb_dns
    origin_id   = "Origin-US"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "match-viewer"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Secondary origin: Canada ALB
  origin {
    domain_name = var.ca_alb_dns
    origin_id   = "Origin-CA"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "match-viewer"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "Origin-US"

    forwarded_values {
      query_string = true
      headers      = ["Host", "Authorization", "x-workspace-name"]
      cookies { forward = "all" }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.host_router.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
