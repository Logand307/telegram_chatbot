#!/bin/bash

# Telegram RAG Bot Deployment Script
# This script provides common deployment commands for different pipeline scenarios

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if .env file exists
if [ ! -f .env ]; then
    print_error ".env file not found. Please create it from env.template first."
    exit 1
fi

# Function to check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker first."
        exit 1
    fi
}

# Function to build Docker image
build_image() {
    print_status "Building Docker image..."
    docker build -t telegram-rag-bot .
    print_status "Docker image built successfully!"
}

# Function to deploy with Docker Compose
deploy_compose() {
    print_status "Deploying with Docker Compose..."
    docker-compose up -d
    print_status "Deployment completed! Check status with: docker-compose ps"
}

# Function to deploy standalone Docker container
deploy_standalone() {
    print_status "Deploying standalone Docker container..."
    
    # Stop existing container if running
    if docker ps -q -f name=telegram-bot | grep -q .; then
        print_status "Stopping existing container..."
        docker stop telegram-bot
        docker rm telegram-bot
    fi
    
    # Run new container
    docker run -d \
        --name telegram-bot \
        -p 3000:3000 \
        --env-file .env \
        --restart unless-stopped \
        telegram-rag-bot
    
    print_status "Container deployed! Check logs with: docker logs telegram-bot"
}

# Function to check deployment health
check_health() {
    print_status "Checking deployment health..."
    
    # Wait a moment for the service to start
    sleep 5
    
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        print_status "Health check passed! Service is running."
        echo "Health endpoint: http://localhost:3000/health"
        echo "Status endpoint: http://localhost:3000/"
    else
        print_error "Health check failed! Service may not be running properly."
        exit 1
    fi
}

# Function to show logs
show_logs() {
    print_status "Showing recent logs..."
    if docker ps -q -f name=telegram-bot | grep -q .; then
        docker logs --tail=50 telegram-bot
    elif docker-compose ps -q | grep -q .; then
        docker-compose logs --tail=50
    else
        print_error "No running containers found."
    fi
}

# Function to stop deployment
stop_deployment() {
    print_status "Stopping deployment..."
    
    # Stop Docker Compose if running
    if docker-compose ps -q | grep -q .; then
        docker-compose down
        print_status "Docker Compose stopped."
    fi
    
    # Stop standalone container if running
    if docker ps -q -f name=telegram-bot | grep -q .; then
        docker stop telegram-bot
        docker rm telegram-bot
        print_status "Standalone container stopped."
    fi
    
    print_status "All deployments stopped."
}

# Function to show deployment status
show_status() {
    print_status "Deployment status:"
    
    echo "Docker Compose services:"
    docker-compose ps 2>/dev/null || echo "No Docker Compose services running"
    
    echo -e "\nStandalone containers:"
    docker ps --filter name=telegram-bot --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
}

# Main script logic
case "${1:-help}" in
    "build")
        check_docker
        build_image
        ;;
    "deploy")
        check_docker
        build_image
        deploy_compose
        check_health
        ;;
    "deploy-standalone")
        check_docker
        build_image
        deploy_standalone
        check_health
        ;;
    "health")
        check_health
        ;;
    "logs")
        show_logs
        ;;
    "stop")
        stop_deployment
        ;;
    "status")
        show_status
        ;;
    "restart")
        stop_deployment
        sleep 2
        deploy_compose
        check_health
        ;;
    "help"|*)
        echo "Telegram RAG Bot Deployment Script"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  build              - Build Docker image"
        echo "  deploy             - Deploy with Docker Compose"
        echo "  deploy-standalone  - Deploy standalone Docker container"
        echo "  health             - Check deployment health"
        echo "  logs               - Show recent logs"
        echo "  stop               - Stop all deployments"
        echo "  status             - Show deployment status"
        echo "  restart            - Restart deployment"
        echo "  help               - Show this help message"
        echo ""
        echo "Examples:"
        echo "  $0 deploy          # Deploy with Docker Compose"
        echo "  $0 health          # Check if service is healthy"
        echo "  $0 logs            # View recent logs"
        ;;
esac
