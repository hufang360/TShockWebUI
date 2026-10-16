package tshock

import "testing"

func TestNormalizeTarget(t *testing.T) {
	cases := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"", "", false},
		{"127.0.0.1", "http://127.0.0.1:7878", false},
		{"127.0.0.1:7878", "http://127.0.0.1:7878", false},
		{"1.2.3.4:9999", "http://1.2.3.4:9999", false},
		{"https://example.com", "https://example.com:7878", false},
		{"http://example.com:8080", "http://example.com:8080", false},
		{"http://host:7878/", "http://host:7878", false},
		{"http://[::1]:7878", "http://[::1]:7878", false},
		{"ftp://host", "", true},
		{"http://host/path", "", true},
		{"http://host?a=1", "", true},
		{"http://user:pass@host:7878", "", true},
		{"http://host:0", "", true},
		{"http://host:70000", "", true},
	}
	for _, c := range cases {
		got, err := NormalizeTarget(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("NormalizeTarget(%q) 期望错误，得到 %q", c.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("NormalizeTarget(%q) 错误：%v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("NormalizeTarget(%q) = %q，期望 %q", c.in, got, c.want)
		}
	}
}
