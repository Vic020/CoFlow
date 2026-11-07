package assistant

import (
	"encoding/json"
	"strings"
)

func webBase(provider string) string {
	switch provider {
	case "deepseek":
		return "https://api.deepseek.com/v1/tools"
	case "tavily":
		return "https://api.tavily.com"
	case "exa":
		return "https://api.exa.ai"
	case "firecrawl":
		return "https://api.firecrawl.dev/v2"
	}
	return ""
}
func webRequest(provider, route, query, target string) (string, any, string, error) {
	base := webBase(provider)
	if base == "" {
		return "", nil, "", invalid("请选择联网服务商")
	}
	header := "Authorization"
	var payload any
	switch provider {
	case "deepseek":
		if route == "search" {
			payload = map[string]any{"query": query, "count": 5, "need_content": false}
		} else {
			payload = map[string]any{"url": target}
		}
	case "tavily":
		if route == "search" {
			payload = map[string]any{"query": query, "max_results": 5, "search_depth": "basic", "include_answer": false, "include_raw_content": false}
		} else {
			route = "extract"
			payload = map[string]any{"urls": []string{target}, "extract_depth": "basic", "format": "markdown"}
		}
	case "exa":
		header = "x-api-key"
		if route == "search" {
			payload = map[string]any{"query": query, "numResults": 5, "type": "auto", "contents": map[string]any{"highlights": true}}
		} else {
			route = "contents"
			payload = map[string]any{"urls": []string{target}, "text": true}
		}
	case "firecrawl":
		if route == "search" {
			payload = map[string]any{"query": query, "limit": 5, "sources": []string{"web"}, "domainTools": false}
		} else {
			route = "scrape"
			payload = map[string]any{"url": target, "formats": []string{"markdown"}, "onlyMainContent": true, "timeout": 7000}
		}
	}
	return base + "/" + route, payload, header, nil
}

type webResult struct {
	Title         string   `json:"title"`
	URL           string   `json:"url"`
	Summary       string   `json:"summary"`
	Snippet       string   `json:"snippet"`
	Content       string   `json:"content"`
	RawContent    string   `json:"raw_content"`
	Text          string   `json:"text"`
	Description   string   `json:"description"`
	Highlights    []string `json:"highlights"`
	Date          string   `json:"date"`
	PublishedDate string   `json:"publishedDate"`
}

func (w *webSession) decodeWeb(route, target, key string, raw []byte) (any, error) {
	invalidResult := func() (any, error) { return nil, invalid("联网结果过长或无效") }
	var data struct {
		Results []webResult `json:"results"`
		Title   string      `json:"title"`
		Content string      `json:"content"`
		Success *bool       `json:"success"`
		Data    struct {
			Web      []webResult `json:"web"`
			Markdown string      `json:"markdown"`
			Metadata struct {
				Title string `json:"title"`
			} `json:"metadata"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &data) != nil || data.Success != nil && !*data.Success {
		return invalidResult()
	}
	results := data.Results
	if w.provider == "firecrawl" {
		if data.Success == nil {
			return invalidResult()
		}
		results = data.Data.Web
	}
	if route == "search" {
		if results == nil {
			return invalidResult()
		}
		rows := []map[string]string{}
		for _, r := range results {
			if len(rows) == 5 {
				break
			}
			if len(r.URL) > 2048 {
				continue
			}
			u := w.source(r.Title, r.URL, key)
			if u == "" {
				continue
			}
			text := r.Summary
			for _, v := range []string{r.Snippet, r.Content, r.Description, strings.Join(r.Highlights, " ")} {
				if text == "" {
					text = v
				}
			}
			date := r.Date
			if date == "" {
				date = r.PublishedDate
			}
			rows = append(rows, map[string]string{"title": w.clean(r.Title, key, 200), "url": u, "summary": w.clean(text, key, 1500), "date": w.clean(date, key, 80)})
		}
		return map[string]any{"results": rows, "untrusted_web_content": true}, nil
	}
	title, content := data.Title, data.Content
	switch w.provider {
	case "tavily", "exa":
		if len(results) == 0 {
			return invalidResult()
		}
		title = results[0].Title
		content = results[0].RawContent
		if w.provider == "exa" {
			content = results[0].Text
		}
	case "firecrawl":
		title = data.Data.Metadata.Title
		content = data.Data.Markdown
	}
	if strings.TrimSpace(content) == "" {
		return invalidResult()
	}
	w.source(title, target, key)
	return map[string]any{"title": w.clean(title, key, 200), "url": target, "content": w.clean(content, key, 8000), "truncated": len([]rune(content)) > 8000, "untrusted_web_content": true}, nil
}
