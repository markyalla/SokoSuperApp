#!/bin/bash

set -e
set -u

function create_database_and_setup() {
	local database=$1
	echo "  Creating database '$database'"
	psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
	    CREATE DATABASE $database;
EOSQL

    echo "  Enabling extensions and types in '$database'"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$database" <<-EOSQL
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
        CREATE EXTENSION IF NOT EXISTS postgis;
EOSQL

    # Add specific ENUMs based on the database name
    case "$database" in
        "sokoaccount")
            psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$database" <<-EOSQL
                DO \$\$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gender_enum') THEN
                        CREATE TYPE gender_enum AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kyc_status_enum') THEN
                        CREATE TYPE kyc_status_enum AS ENUM ('pending', 'submitted', 'under_review', 'approved', 'rejected');
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'role_enum') THEN
                        CREATE TYPE role_enum AS ENUM ('user', 'driver', 'artisan', 'sokoshopper_admin', 'sokodelivery_admin', 'sokoloan_admin', 'sokosusu_admin', 'sokobank_admin', 'superadmin');
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'driver_status_enum') THEN
                        CREATE TYPE driver_status_enum AS ENUM ('pending', 'active', 'suspended', 'offline');
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vehicle_type_enum') THEN
                        CREATE TYPE vehicle_type_enum AS ENUM ('bicycle', 'motorcycle', 'car', 'van', 'truck');
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_type_enum') THEN
                        CREATE TYPE document_type_enum AS ENUM ('national_id', 'passport', 'drivers_license', 'utility_bill', 'bank_statement', 'selfie');
                    END IF;
                END \$\$;
EOSQL
            ;;
        "sokoshopper")
            psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$database" <<-EOSQL
                DO \$\$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status_enum') THEN
                        CREATE TYPE order_status_enum AS ENUM ('pending', 'payment_pending', 'payment_confirmed', 'preparing', 'ready_for_pickup', 'assigned_to_driver', 'picked_up', 'delivered', 'cancelled', 'refunded');
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'restaurant_status_enum') THEN
                        CREATE TYPE restaurant_status_enum AS ENUM ('active', 'inactive', 'suspended');
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status_enum') THEN
                        CREATE TYPE payment_status_enum AS ENUM ('pending', 'initiated', 'success', 'failed', 'refunded');
                    END IF;
                END \$\$;
EOSQL
            ;;
        "sokodelivery")
            psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$database" <<-EOSQL
                DO \$\$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_status_enum') THEN
                        CREATE TYPE delivery_status_enum AS ENUM ('pending', 'broadcast', 'accepted', 'arrived_at_vendor', 'picked_up', 'in_transit', 'arrived_at_customer', 'delivered', 'failed', 'cancelled');
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_source_enum') THEN
                        CREATE TYPE delivery_source_enum AS ENUM ('sokoshopper', 'sokodelivery');
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'earning_status_enum') THEN
                        CREATE TYPE earning_status_enum AS ENUM ('pending', 'settled', 'on_hold');
                    END IF;
                END \$\$;
EOSQL
            ;;
        "sokobank")
            psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$database" <<-EOSQL
                DO \$\$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_type_enum') THEN
                        CREATE TYPE account_type_enum AS ENUM ('wallet', 'savings', 'current', 'escrow', 'trust');
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_status_enum') THEN
                        CREATE TYPE account_status_enum AS ENUM ('pending', 'active', 'frozen', 'closed');
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'txn_type_enum') THEN
                        CREATE TYPE txn_type_enum AS ENUM ('credit', 'debit', 'transfer_in', 'transfer_out', 'fee', 'refund', 'interest', 'loan_disbursement', 'loan_repayment', 'susu_contribution', 'susu_payout', 'order_payment', 'driver_earning');
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'txn_status_enum') THEN
                        CREATE TYPE txn_status_enum AS ENUM ('pending', 'processing', 'success', 'failed', 'reversed');
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_status_enum') THEN
                        CREATE TYPE transfer_status_enum AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
                    END IF;
                END \$\$;
EOSQL
            ;;
    esac
}

if [ -n "$POSTGRES_MULTIPLE_DATABASES" ]; then
	for db in $(echo $POSTGRES_MULTIPLE_DATABASES | tr ',' ' '); do
		create_database_and_setup $db
	done
fi