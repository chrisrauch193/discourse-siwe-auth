# frozen_string_literal: true

# name: discourse-siwe
# about: A discourse plugin to enable users to authenticate via Sign In with Ethereum
# version: 0.1.3

enabled_site_setting :discourse_siwe_enabled
register_svg_icon 'fab-ethereum'
register_asset 'stylesheets/discourse-siwe.scss'

%w[
  ../lib/omniauth/strategies/siwe.rb
].each { |path| load File.expand_path(path, __FILE__) }

gem 'pkg-config', '1.5.6', require: false
gem 'forwardable', '1.3.3', require: false
gem 'mkmfmf', '0.4', require: false
gem 'keccak', '1.3.0', require: false
gem 'zip', '2.0.2', require: false
gem 'mini_portile2', '2.8.0', require: false
gem 'rbsecp256k1', '6.0.0', require: false
gem 'konstructor', '1.0.2', require: false
gem 'ffi', '1.17.2', require: false
gem 'ffi-compiler', '1.0.1', require: false
gem 'scrypt', '3.0.7', require: false
gem 'eth', '0.5.11', require: false
gem 'siwe', '1.1.2', require: false

class ::SiweAuthenticator < ::Auth::ManagedAuthenticator
  def name
    'siwe'
  end

  def register_middleware(omniauth)
    omniauth.provider :siwe,
                      setup: lambda { |env|
                        strategy = env['omniauth.strategy']
                      }
  end

  def enabled?
    SiteSetting.discourse_siwe_enabled
  end

  def primary_email_verified?
    false
  end
  
  def after_authenticate(auth, existing_account: nil)
    Rails.logger.info("[SIWE Authenticator] after_authenticate called")
    Rails.logger.info("[SIWE Authenticator] auth uid: #{auth[:uid]}")
    Rails.logger.info("[SIWE Authenticator] auth info: #{auth[:info]}")
    
    result = super
    
    Rails.logger.info("[SIWE Authenticator] super completed, result: #{result.inspect}")
    
    # Handle return_to redirect - check extra_data from the auth hash
    # The session data is passed through auth[:extra][:raw_info] if needed
    
    # Check DAO membership if enabled
    if SiteSetting.siwe_enable_membership_check && 
       SiteSetting.siwe_rpc_url.present? && 
       SiteSetting.siwe_dao_contract_address.present?
      
      wallet_address = auth[:uid] || auth.dig(:extra, :raw_info, :eth_address)
      
      if wallet_address.present?
        membership_status = check_dao_membership(wallet_address)
        result.extra_data ||= {}
        result.extra_data[:dao_membership] = membership_status
        
        Rails.logger.info("[SIWE] Membership check for #{wallet_address}: #{membership_status}")
        
        # If this is an existing user logging in, update their group membership
        if existing_account
          update_dao_groups(existing_account, membership_status)
        end
      end
    end
    
    result
  end
  
  def after_create_account(user, auth)
    super
    
    # Assign user to appropriate group based on DAO membership
    membership_status = auth&.extra_data&.dig(:dao_membership)
    
    if membership_status.present?
      assign_dao_group(user, membership_status)
    elsif SiteSetting.siwe_enable_membership_check
      # If membership check is enabled but we don't have status, treat as guest
      assign_dao_group(user, :guest)
    end
  end
  
  private
  
  def check_dao_membership(wallet_address)
    require_relative '../lib/discourse_siwe/ethereum_client'
    
    client = DiscourseSiwe::EthereumClient.new(SiteSetting.siwe_rpc_url)
    contract = SiteSetting.siwe_dao_contract_address
    
    is_member = client.is_member?(contract, wallet_address)
    
    if is_member
      is_restricted = client.is_restricted?(contract, wallet_address)
      is_restricted ? :restricted : :member
    else
      :guest
    end
  rescue StandardError => e
    Rails.logger.error("[SIWE] Membership check failed: #{e.message}")
    :guest
  end
  
  def assign_dao_group(user, membership_status)
    group_name = get_group_name_for_status(membership_status)
    return if group_name.blank?
    
    group = Group.find_by(name: group_name)
    if group && !user.groups.include?(group)
      group.add(user)
      Rails.logger.info("[SIWE] Added user #{user.username} to group #{group_name}")
    elsif !group
      Rails.logger.warn("[SIWE] Group '#{group_name}' not found - create it in Admin > Groups")
    end
  rescue StandardError => e
    Rails.logger.error("[SIWE] Failed to assign group: #{e.message}")
  end
  
  def update_dao_groups(user, membership_status)
    # Remove user from all DAO groups first
    all_dao_groups = [
      SiteSetting.siwe_members_group,
      SiteSetting.siwe_restricted_group,
      SiteSetting.siwe_guests_group
    ].compact.reject(&:blank?)
    
    all_dao_groups.each do |group_name|
      group = Group.find_by(name: group_name)
      if group && user.groups.include?(group)
        group.remove(user)
        Rails.logger.info("[SIWE] Removed user #{user.username} from group #{group_name}")
      end
    end
    
    # Add to the correct group
    assign_dao_group(user, membership_status)
  rescue StandardError => e
    Rails.logger.error("[SIWE] Failed to update groups: #{e.message}")
  end
  
  def get_group_name_for_status(membership_status)
    case membership_status.to_sym
    when :member
      SiteSetting.siwe_members_group
    when :restricted
      SiteSetting.siwe_restricted_group
    else
      SiteSetting.siwe_guests_group
    end
  end
end

auth_provider authenticator: ::SiweAuthenticator.new,
              icon: 'fab-ethereum',
              full_screen_login: true

after_initialize do
  %w[
    ../lib/discourse_siwe/engine.rb
    ../lib/discourse_siwe/routes.rb
    ../lib/discourse_siwe/ethereum_client.rb
    ../app/controllers/discourse_siwe/auth_controller.rb
  ].each { |path| load File.expand_path(path, __FILE__) }

  Discourse::Application.routes.prepend do
    mount ::DiscourseSiwe::Engine, at: '/discourse-siwe'
  end
end

# Allow WebAssembly for AppKit wallet connections
extend_content_security_policy(script_src: [:wasm_unsafe_eval])

# Allow AppKit connections to Reown/WalletConnect services
extend_content_security_policy(
  connect_src: %w[
    wss://relay.walletconnect.com
    wss://relay.walletconnect.org
    https://api.web3modal.com
    https://api.web3modal.org
    https://rpc.walletconnect.com
    https://rpc.walletconnect.org
    https://explorer-api.walletconnect.com
    https://pulse.walletconnect.com
    https://pulse.walletconnect.org
    wss://*.walletconnect.com
    wss://*.walletconnect.org
  ]
)
