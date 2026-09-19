package server

import (
	"net"
	"net/http"
	"os"
	"strings"
)

/*
Forwarding headers are client-settable. Plugins that key on them (the auth plugin's login
rate limiter reads X-Forwarded-For) would let anyone reset their own limit by sending a new
value. So before any handler runs, the guard drops X-Forwarded-For / X-Real-IP /
Forwarded unless the request comes straight from a trusted proxy: TRUSTED_PROXIES, a
comma-separated list of IPs or CIDRs (default: loopback only). Behind the production tunnel
or reverse proxy, list that hop's address.
*/

var forwardingHeaders = []string{"X-Forwarded-For", "X-Real-Ip", "Forwarded", "True-Client-Ip", "Cf-Connecting-Ip"}

func trustedProxies() []*net.IPNet {
	raw := strings.TrimSpace(os.Getenv("TRUSTED_PROXIES"))
	if raw == "" {
		raw = "127.0.0.1/32,::1/128"
	}
	var out []*net.IPNet
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if !strings.Contains(part, "/") {
			if ip := net.ParseIP(part); ip != nil && ip.To4() != nil {
				part += "/32"
			} else {
				part += "/128"
			}
		}
		if _, n, err := net.ParseCIDR(part); err == nil {
			out = append(out, n)
		}
	}
	return out
}

// stripUntrustedForwarding removes forwarding headers from requests that did not come from
// a trusted proxy.
func stripUntrustedForwarding(trusted []*net.IPNet, r *http.Request) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil {
		for _, n := range trusted {
			if n.Contains(ip) {
				return
			}
		}
	}
	for _, h := range forwardingHeaders {
		r.Header.Del(h)
	}
}
