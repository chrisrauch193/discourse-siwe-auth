# frozen_string_literal: true

require 'net/http'
require 'json'
require 'uri'

module DiscourseSiwe
  class EthereumClient
    # ABI function signatures (keccak256 hash of function signature, first 4 bytes)
    # isMember(address) -> 0xa230c524
    # isRestricted(address) -> 0xc01bc982
    FUNCTION_SELECTORS = {
      is_member: '0xa230c524',
      is_restricted: '0xc01bc982'
    }.freeze

    def initialize(rpc_url)
      @rpc_url = rpc_url
      @request_id = 0
    end

    # Check if an address is a member of the DAO
    # @param contract_address [String] The CoreDAO contract address
    # @param wallet_address [String] The wallet address to check
    # @return [Boolean] true if the address is a member
    def is_member?(contract_address, wallet_address)
      call_bool_function(contract_address, FUNCTION_SELECTORS[:is_member], wallet_address)
    end

    # Check if an address is restricted
    # @param contract_address [String] The CoreDAO contract address
    # @param wallet_address [String] The wallet address to check
    # @return [Boolean] true if the address is restricted
    def is_restricted?(contract_address, wallet_address)
      call_bool_function(contract_address, FUNCTION_SELECTORS[:is_restricted], wallet_address)
    end

    private

    # Call a contract function that takes an address and returns a bool
    def call_bool_function(contract_address, function_selector, address)
      # Encode the call data: function selector + padded address
      # Address must be 32 bytes (64 hex chars), left-padded with zeros
      padded_address = address.sub(/^0x/i, '').downcase.rjust(64, '0')
      data = "#{function_selector}#{padded_address}"

      result = eth_call(contract_address, data)
      
      # Result is a hex string representing a uint256 (0 or 1 for bool)
      # 0x0000...0001 = true, 0x0000...0000 = false
      return false if result.nil? || result == '0x'
      
      # Parse the last byte to determine true/false
      result.to_i(16) != 0
    rescue StandardError => e
      Rails.logger.error("[SIWE] Ethereum call failed: #{e.message}")
      false
    end

    # Make an eth_call JSON-RPC request
    def eth_call(to, data)
      response = json_rpc_request('eth_call', [
        { to: to, data: data },
        'latest'
      ])
      
      response['result']
    end

    # Make a JSON-RPC request to the Ethereum node
    def json_rpc_request(method, params)
      @request_id += 1
      
      uri = URI.parse(@rpc_url)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = (uri.scheme == 'https')
      http.read_timeout = 10
      http.open_timeout = 5

      request = Net::HTTP::Post.new(uri.request_uri)
      request['Content-Type'] = 'application/json'
      request.body = {
        jsonrpc: '2.0',
        method: method,
        params: params,
        id: @request_id
      }.to_json

      response = http.request(request)
      
      if response.code.to_i != 200
        Rails.logger.error("[SIWE] RPC request failed with status #{response.code}")
        return {}
      end

      JSON.parse(response.body)
    rescue StandardError => e
      Rails.logger.error("[SIWE] RPC request error: #{e.message}")
      {}
    end
  end
end
