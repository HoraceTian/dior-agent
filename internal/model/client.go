package model

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type Client struct {
	httpClient *http.Client
}

func NewClient() *Client {
	return &Client{httpClient: http.DefaultClient}
}

func (c *Client) Stream(ctx context.Context, snapshot Snapshot, messages []Message, onDelta func(string) error) (string, error) {
	body := map[string]any{
		"model":    snapshot.Resolved.ModelName,
		"messages": messages,
		"stream":   true,
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, chatCompletionsURL(snapshot.Resolved), bytes.NewReader(encoded))
	if err != nil {
		return "", err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("accept", "application/json")
	if snapshot.Resolved.Provider == ProviderOpenAI {
		token := strings.TrimSpace(os.Getenv(snapshot.Resolved.APIKeyEnv))
		if token == "" {
			return "", fmt.Errorf("missing OpenAI API key env: %s", snapshot.Resolved.APIKeyEnv)
		}
		req.Header.Set("authorization", "Bearer "+token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("model request failed with HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(detail)))
	}

	if !strings.Contains(resp.Header.Get("content-type"), "text/event-stream") {
		content, err := extractNonStreamingContent(resp.Body)
		if err != nil {
			return "", err
		}
		if content != "" {
			if err := onDelta(content); err != nil {
				return "", err
			}
		}
		return content, nil
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var output strings.Builder
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" {
			continue
		}
		if data == "[DONE]" {
			break
		}
		delta := extractStreamingDelta([]byte(data))
		if delta == "" {
			continue
		}
		output.WriteString(delta)
		if err := onDelta(delta); err != nil {
			return "", err
		}
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return output.String(), nil
}

func chatCompletionsURL(config ResolvedConfig) string {
	base := strings.TrimRight(config.BaseURL, "/")
	if config.Provider == ProviderOllama && !strings.HasSuffix(base, "/v1") {
		return base + "/v1/chat/completions"
	}
	return base + "/chat/completions"
}

func extractStreamingDelta(data []byte) string {
	var payload struct {
		Choices []struct {
			Delta struct {
				Content string `json:"content"`
			} `json:"delta"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &payload); err != nil || len(payload.Choices) == 0 {
		return ""
	}
	return payload.Choices[0].Delta.Content
}

func extractNonStreamingContent(reader io.Reader) (string, error) {
	var payload struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(reader).Decode(&payload); err != nil {
		return "", err
	}
	if len(payload.Choices) == 0 {
		return "", nil
	}
	return payload.Choices[0].Message.Content, nil
}
