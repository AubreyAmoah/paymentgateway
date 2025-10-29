#!/bin/bash

# Payment Gateway Deployment Script
# Usage: ./deploy.sh [start|stop|restart|logs|status|backup]

set -e

COMPOSE_FILE="docker-compose.yml"
APP_NAME="payment-gateway"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored messages
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Check if docker-compose is installed
check_requirements() {
    if ! command -v docker-compose &> /dev/null; then
        print_error "docker-compose is not installed"
        exit 1
    fi

    if ! command -v docker &> /dev/null; then
        print_error "docker is not installed"
        exit 1
    fi
}

# Create necessary directories
setup_directories() {
    print_info "Creating necessary directories..."
    mkdir -p data logs logs/nginx ssl
    print_success "Directories created"
}

# Start services
start_services() {
    print_info "Starting services..."
    setup_directories

    if [ ! -f .env ]; then
        print_error ".env file not found. Please create it first."
        exit 1
    fi

    docker-compose up -d
    print_success "Services started"

    # Wait for services to be healthy
    print_info "Waiting for services to be ready..."
    sleep 5

    # Initialize database if needed
    print_info "Initializing database..."
    docker-compose exec -T $APP_NAME npx prisma db push || true

    print_success "Deployment complete!"
    print_info "Check status with: ./deploy.sh status"
    print_info "View logs with: ./deploy.sh logs"
}

# Stop services
stop_services() {
    print_info "Stopping services..."
    docker-compose down
    print_success "Services stopped"
}

# Restart services
restart_services() {
    print_info "Restarting services..."
    docker-compose restart
    print_success "Services restarted"
}

# View logs
view_logs() {
    docker-compose logs -f
}

# Check status
check_status() {
    print_info "Container Status:"
    docker-compose ps
    echo ""
    print_info "Health Check:"
    curl -s http://localhost/health | jq '.' 2>/dev/null || curl -s http://localhost/health
}

# Backup database
backup_database() {
    print_info "Creating database backup..."
    BACKUP_NAME="backup-$(date +%Y%m%d_%H%M%S).db"
    docker-compose exec -T $APP_NAME cp /app/data/dev.db /app/data/$BACKUP_NAME
    docker cp ${APP_NAME}:/app/data/$BACKUP_NAME ./data/$BACKUP_NAME
    print_success "Backup created: data/$BACKUP_NAME"
}

# Update application
update_app() {
    print_info "Updating application..."
    docker-compose down
    docker-compose build --no-cache
    docker-compose up -d
    print_success "Application updated"
}

# Main script
main() {
    check_requirements

    case "${1:-}" in
        start)
            start_services
            ;;
        stop)
            stop_services
            ;;
        restart)
            restart_services
            ;;
        logs)
            view_logs
            ;;
        status)
            check_status
            ;;
        backup)
            backup_database
            ;;
        update)
            update_app
            ;;
        *)
            echo "Payment Gateway Deployment Script"
            echo ""
            echo "Usage: $0 {start|stop|restart|logs|status|backup|update}"
            echo ""
            echo "Commands:"
            echo "  start   - Start all services"
            echo "  stop    - Stop all services"
            echo "  restart - Restart all services"
            echo "  logs    - View application logs"
            echo "  status  - Check service status and health"
            echo "  backup  - Backup the database"
            echo "  update  - Rebuild and update application"
            exit 1
            ;;
    esac
}

main "$@"
