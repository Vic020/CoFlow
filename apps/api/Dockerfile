FROM golang:1.25-alpine AS build
WORKDIR /src
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /coflow-api ./cmd/server

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 coflow
COPY --from=build /coflow-api /usr/local/bin/coflow-api
USER coflow
ENV COFLOW_ADDR=0.0.0.0:8080
EXPOSE 8080
CMD ["coflow-api"]
