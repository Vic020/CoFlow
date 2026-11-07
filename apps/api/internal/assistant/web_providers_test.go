package assistant

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestIndependentWebProviderContracts(t *testing.T) {
	cases := []struct{ provider, host, search, fetch, searchResult, fetchResult string }{
		{"deepseek", "api.deepseek.com", "/v1/tools/search", "/v1/tools/fetch", `{"results":[{"title":"Docs","url":"https://docs.example.com/","summary":"Public"}]}`, `{"title":"Docs","content":"Page"}`},
		{"tavily", "api.tavily.com", "/search", "/extract", `{"results":[{"title":"Docs","url":"https://docs.example.com/","content":"Public"}]}`, `{"results":[{"url":"https://docs.example.com/","raw_content":"Page"}],"failed_results":[]}`},
		{"exa", "api.exa.ai", "/search", "/contents", `{"results":[{"title":"Docs","url":"https://docs.example.com/","highlights":["Public"]}]}`, `{"results":[{"title":"Docs","url":"https://docs.example.com/","text":"Page"}]}`},
		{"firecrawl", "api.firecrawl.dev", "/v2/search", "/v2/scrape", `{"success":true,"data":{"web":[{"title":"Docs","url":"https://docs.example.com/","description":"Public"}]}}`, `{"success":true,"data":{"markdown":"Page","metadata":{"title":"Docs"}}}`},
	}
	for _, tc := range cases {
		t.Run(tc.provider, func(t *testing.T) {
			calls := 0
			s := &Service{Client: &http.Client{Transport: transportFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.URL.Host != tc.host {
					t.Fatal("wrong vendor")
				}
				var body map[string]any
				json.NewDecoder(r.Body).Decode(&body)
				if tc.provider == "exa" {
					if r.Header.Get("x-api-key") != "synthetic-search-key" || r.Header.Get("Authorization") != "" {
						t.Fatal("wrong Exa auth")
					}
				} else if r.Header.Get("Authorization") != "Bearer synthetic-search-key" {
					t.Fatal("wrong bearer")
				}
				if r.URL.Path == tc.search {
					switch tc.provider {
					case "tavily":
						if body["max_results"] != float64(5) || body["search_depth"] != "basic" || body["include_raw_content"] != false {
							t.Fatal("Tavily bounded contract")
						}
					case "exa":
						if body["numResults"] != float64(5) || body["type"] != "auto" {
							t.Fatal("Exa bounded contract")
						}
					case "firecrawl":
						if body["limit"] != float64(5) || body["scrapeOptions"] != nil || body["domainTools"] != false {
							t.Fatal("Firecrawl bounded contract")
						}
					}
					if body["query"] != "public docs" {
						t.Fatal("query")
					}
					return response(tc.searchResult), nil
				}
				if r.URL.Path != tc.fetch {
					t.Fatal("wrong fetch product")
				}
				return response(tc.fetchResult), nil
			})}}
			w := newWebSession("")
			w.provider = tc.provider
			w.secrets = []string{"private-model-key"}
			if _, e := s.webTool(context.Background(), w, "web_search", `{"query":"public docs"}`, "synthetic-search-key"); e != nil {
				t.Fatal(e)
			}
			v, e := s.webTool(context.Background(), w, "web_fetch", `{"url":"https://docs.example.com/"}`, "synthetic-search-key")
			if e != nil || v.(map[string]any)["content"] != "Page" || len(w.sources) != 1 {
				t.Fatal(v, e)
			}
			if _, e = s.webTool(context.Background(), w, "web_fetch", `{"url":"https://docs.example.com/"}`, "synthetic-search-key"); e != nil || calls != 2 {
				t.Fatal("repeat charged", e)
			}
			if _, e = s.webTool(context.Background(), w, "web_search", `{"query":"private-model-key"}`, "synthetic-search-key"); e == nil || calls != 2 {
				t.Fatal("model key sent to search vendor")
			}
			raw, _ := json.Marshal(v)
			if strings.Contains(string(raw), "synthetic-search-key") {
				t.Fatal("key leaked")
			}
		})
	}
	if _, _, _, e := webRequest("unknown", "search", "x", ""); e == nil {
		t.Fatal("arbitrary provider accepted")
	}
	w := newWebSession("")
	w.provider = "firecrawl"
	if _, e := w.decodeWeb("search", "", "synthetic-key", []byte(`{"success":false,"error":"synthetic-key"}`)); e == nil || strings.Contains(e.Error(), "synthetic-key") {
		t.Fatal("provider error echoed")
	}
}
