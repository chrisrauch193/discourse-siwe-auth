# frozen_string_literal: true

module DiscourseSiwe
  class AdminController < ::Admin::AdminController
    # Admin-only controller for managing SIWE wallet links
    # All actions require admin authentication
    
    # POST /discourse-siwe/admin/link_wallet
    # Links a wallet address to an existing user
    #
    # Params:
    #   username: Discourse username
    #   wallet_address: Ethereum wallet address (0x...)
    #
    # This creates a UserAssociatedAccount record as if the user
    # had signed in via SIWE, enabling bot accounts to appear
    # as wallet-authenticated users.
    def link_wallet
      username = params[:username]
      wallet_address = params[:wallet_address]
      
      if username.blank? || wallet_address.blank?
        return render json: { 
          success: false, 
          error: "username and wallet_address are required" 
        }, status: 400
      end
      
      # Validate wallet address format
      unless wallet_address.match?(/\A0x[a-fA-F0-9]{40}\z/)
        return render json: { 
          success: false, 
          error: "Invalid wallet address format" 
        }, status: 400
      end
      
      # Find user
      user = User.find_by(username: username)
      unless user
        return render json: { 
          success: false, 
          error: "User '#{username}' not found" 
        }, status: 404
      end
      
      # Check if already linked
      existing = UserAssociatedAccount.find_by(
        provider_name: 'siwe',
        provider_uid: wallet_address
      )
      
      if existing
        if existing.user_id == user.id
          return render json: { 
            success: true, 
            message: "Wallet already linked to this user",
            user_id: user.id,
            wallet_address: wallet_address
          }
        else
          return render json: { 
            success: false, 
            error: "Wallet already linked to another user (ID: #{existing.user_id})" 
          }, status: 409
        end
      end
      
      # Check if user already has a SIWE wallet linked
      user_existing = UserAssociatedAccount.find_by(
        user_id: user.id,
        provider_name: 'siwe'
      )
      
      if user_existing
        # Update existing link
        user_existing.update!(provider_uid: wallet_address)
        Rails.logger.info("[SIWE Admin] Updated wallet link for user #{username}: #{wallet_address}")
        
        return render json: { 
          success: true, 
          message: "Updated wallet link",
          user_id: user.id,
          wallet_address: wallet_address,
          previous_wallet: user_existing.provider_uid_was
        }
      end
      
      # Create new link
      UserAssociatedAccount.create!(
        user_id: user.id,
        provider_name: 'siwe',
        provider_uid: wallet_address
      )
      
      Rails.logger.info("[SIWE Admin] Linked wallet #{wallet_address} to user #{username}")
      
      # Update DAO groups if membership check is enabled
      if SiteSetting.siwe_enable_membership_check
        begin
          authenticator = SiweAuthenticator.new
          membership_status = authenticator.send(:check_dao_membership, wallet_address)
          authenticator.send(:update_dao_groups, user, membership_status)
          Rails.logger.info("[SIWE Admin] Updated DAO groups for #{username}: #{membership_status}")
        rescue => e
          Rails.logger.warn("[SIWE Admin] Failed to update DAO groups: #{e.message}")
        end
      end
      
      render json: { 
        success: true, 
        message: "Wallet linked successfully",
        user_id: user.id,
        wallet_address: wallet_address
      }
      
    rescue => e
      Rails.logger.error("[SIWE Admin] link_wallet error: #{e.message}")
      render json: { 
        success: false, 
        error: e.message 
      }, status: 500
    end
    
    # DELETE /discourse-siwe/admin/unlink_wallet
    # Removes wallet link from a user
    #
    # Params:
    #   username: Discourse username
    def unlink_wallet
      username = params[:username]
      
      if username.blank?
        return render json: { 
          success: false, 
          error: "username is required" 
        }, status: 400
      end
      
      user = User.find_by(username: username)
      unless user
        return render json: { 
          success: false, 
          error: "User '#{username}' not found" 
        }, status: 404
      end
      
      link = UserAssociatedAccount.find_by(
        user_id: user.id,
        provider_name: 'siwe'
      )
      
      unless link
        return render json: { 
          success: false, 
          error: "User has no wallet linked" 
        }, status: 404
      end
      
      wallet = link.provider_uid
      link.destroy!
      
      Rails.logger.info("[SIWE Admin] Unlinked wallet #{wallet} from user #{username}")
      
      render json: { 
        success: true, 
        message: "Wallet unlinked",
        wallet_address: wallet
      }
      
    rescue => e
      Rails.logger.error("[SIWE Admin] unlink_wallet error: #{e.message}")
      render json: { 
        success: false, 
        error: e.message 
      }, status: 500
    end
    
    # GET /discourse-siwe/admin/wallet_status
    # Get wallet link status for a user
    #
    # Params:
    #   username: Discourse username
    def wallet_status
      username = params[:username]
      
      if username.blank?
        return render json: { 
          success: false, 
          error: "username is required" 
        }, status: 400
      end
      
      user = User.find_by(username: username)
      unless user
        return render json: { 
          success: false, 
          error: "User '#{username}' not found" 
        }, status: 404
      end
      
      link = UserAssociatedAccount.find_by(
        user_id: user.id,
        provider_name: 'siwe'
      )
      
      response = {
        success: true,
        user_id: user.id,
        username: user.username,
        has_wallet: link.present?,
        wallet_address: link&.provider_uid,
        groups: user.groups.pluck(:name)
      }
      
      # Add DAO membership info if check is enabled
      if link && SiteSetting.siwe_enable_membership_check
        begin
          authenticator = SiweAuthenticator.new
          membership_status = authenticator.send(:check_dao_membership, link.provider_uid)
          response[:dao_membership] = membership_status.to_s
        rescue => e
          response[:dao_membership] = "error: #{e.message}"
        end
      end
      
      render json: response
      
    rescue => e
      Rails.logger.error("[SIWE Admin] wallet_status error: #{e.message}")
      render json: { 
        success: false, 
        error: e.message 
      }, status: 500
    end
    
    # POST /discourse-siwe/admin/bulk_link_wallets
    # Link multiple wallets to users in one request
    #
    # Params:
    #   links: Array of {username, wallet_address} objects
    def bulk_link_wallets
      links = params[:links]
      
      unless links.is_a?(Array)
        return render json: { 
          success: false, 
          error: "links must be an array" 
        }, status: 400
      end
      
      results = {
        success: [],
        failed: []
      }
      
      links.each do |link_params|
        username = link_params[:username]
        wallet_address = link_params[:wallet_address]
        
        begin
          user = User.find_by(username: username)
          unless user
            results[:failed] << { username: username, error: "User not found" }
            next
          end
          
          unless wallet_address.match?(/\A0x[a-fA-F0-9]{40}\z/)
            results[:failed] << { username: username, error: "Invalid wallet address" }
            next
          end
          
          # Check for existing links
          existing = UserAssociatedAccount.find_by(
            provider_name: 'siwe',
            provider_uid: wallet_address
          )
          
          if existing && existing.user_id != user.id
            results[:failed] << { username: username, error: "Wallet linked to another user" }
            next
          end
          
          # Create or update link
          UserAssociatedAccount.find_or_create_by!(
            user_id: user.id,
            provider_name: 'siwe'
          ).update!(provider_uid: wallet_address)
          
          results[:success] << { username: username, wallet_address: wallet_address }
          
        rescue => e
          results[:failed] << { username: username, error: e.message }
        end
      end
      
      Rails.logger.info("[SIWE Admin] Bulk link: #{results[:success].length} success, #{results[:failed].length} failed")
      
      render json: {
        success: true,
        linked: results[:success].length,
        failed: results[:failed].length,
        results: results
      }
      
    rescue => e
      Rails.logger.error("[SIWE Admin] bulk_link_wallets error: #{e.message}")
      render json: { 
        success: false, 
        error: e.message 
      }, status: 500
    end
  end
end
